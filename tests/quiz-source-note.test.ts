/**
 * 回源笔记（`source-note`）的测试。
 *
 * 覆盖两件事：标题链接怎么拼（标题末尾的知识点链接必须转成 Obsidian 的链接写法），
 * 以及打开之后按行号定位——链接落空时，题面也不会把用户丢在笔记顶部。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

setupDom();

import { openQuestionSource, sourceHeading } from "../src/source-note";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { contentHash } from "../src/hash";
import { QuizQuestion } from "../src/types";
import { assert, assertEqual, must, test } from "./harness";
import { MarkdownView, TFile } from "./obsidian-stub";

const options: ParseOptions = { deps: { parseYaml: (source) => yaml.load(source), hash: contentHash } };

const HEADING = "单选题甲 ^[[[300 笔记/内科/ARDS#呼吸窘迫]]]";
const HEADING_LINK = "单选题甲 [300 笔记/内科/ARDS 呼吸窘迫 ]";

/** 题面在第 4 行（0 基）：frontmatter 三行 + 一个空行之后。 */
const BANK = [
	"---",
	"quiz: true",
	"---",
	"",
	`## ${HEADING}`,
	"",
	"- 选项一 ^a",
	"- 选项二 ^b",
	"",
	"```quiz",
	"id: a1",
	"type: single",
	"answer: a",
	"```",
].join("\n");

function bankFile(path = "题库/测试.md"): TFile {
	const file = new TFile();
	file.path = path;
	file.basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
	return file;
}

function question(): QuizQuestion {
	return must(parseQuizFile(BANK, "题库/测试.md", options).questions[0], "未解析出题目");
}

interface FakeView {
	file: TFile;
	states: unknown[];
	setEphemeralState: (state: unknown) => void;
}

/** 一个只记录定位请求的笔记视图；`instanceof MarkdownView` 要成立。 */
function markdownView(file: TFile): FakeView {
	const view = new MarkdownView() as unknown as FakeView;
	view.file = file;
	view.states = [];
	view.setEphemeralState = (state: unknown) => {
		view.states.push(state);
	};
	return view;
}

interface Headings {
	heading: string;
	position: { start: { line: number } };
}

function fakeApp(headings: Headings[] | null, views: FakeView[] = [], active: FakeView | null = null) {
	const calls: { link: string; source: string }[] = [];
	const app = {
		metadataCache: {
			getFileCache: () => (headings === null ? null : { headings }),
		},
		workspace: {
			openLinkText: async (link: string, source: string) => {
				calls.push({ link, source });
			},
			getLeavesOfType: () => views.map((view) => ({ view })),
			getActiveViewOfType: () => active,
		},
	};
	return { app, calls };
}

test("回源：缓存里同行的标题会转成 Obsidian 的链接写法", () => {
	const item = question();
	const { app } = fakeApp([{ heading: HEADING, position: { start: { line: item.line } } }]);
	assertEqual(sourceHeading(app as never, bankFile() as never, item), HEADING_LINK, "带知识点链接的标题");
});

test("回源：行号对不上时按归一化标题找缓存标题，而不是退回不带链接的标题", () => {
	const item = question();
	const { app } = fakeApp([{ heading: HEADING, position: { start: { line: 99 } } }]);
	assertEqual(sourceHeading(app as never, bankFile() as never, item), HEADING_LINK, "按标题兜底");
});

test("回源：缓存里没有这道题时退回解析出的标题", () => {
	const item = question();
	const { app } = fakeApp(null);
	assertEqual(sourceHeading(app as never, bankFile() as never, item), "单选题甲", "没有缓存时的兜底");
});

test("回源：打开链接之后把视图定位到题面那一行", async () => {
	const item = question();
	const file = bankFile();
	const view = markdownView(file);
	const { app, calls } = fakeApp([{ heading: HEADING, position: { start: { line: item.line } } }], [view]);

	await openQuestionSource(app as never, file as never, item);

	assertEqual(calls.length, 1, "应调用一次 openLinkText");
	assertEqual(calls[0]?.link, `题库/测试.md#${HEADING_LINK}`, "链接应带标题子路径");
	assertEqual(calls[0]?.source, "题库/测试.md", "sourcePath 用题库自身的路径");
	assertEqual(view.states.length, 1, "打开后应定位一次");
	assertEqual(JSON.stringify(view.states[0]), JSON.stringify({ line: item.line }), "按行号定位");
});

test("回源：优先定位当前活动的那个笔记视图", async () => {
	const item = question();
	const file = bankFile();
	const first = markdownView(file);
	const second = markdownView(file);
	const { app } = fakeApp([{ heading: HEADING, position: { start: { line: item.line } } }], [first, second], second);

	await openQuestionSource(app as never, file as never, item);

	assertEqual(first.states.length, 0, "非活动视图不该被定位");
	assertEqual(second.states.length, 1, "活动视图应被定位");
});

test("回源：没有题目时只打开文件，不做定位", async () => {
	const file = bankFile();
	const view = markdownView(file);
	const { app, calls } = fakeApp(null, [view]);

	await openQuestionSource(app as never, file as never, undefined);

	assertEqual(calls[0]?.link, "题库/测试.md", "只打开文件");
	assertEqual(view.states.length, 0, "没有题目就不定位");
});

test("回源：宿主缺少查找标签页的接口时不抛错", async () => {
	const item = question();
	const app = {
		metadataCache: { getFileCache: () => ({ headings: [] }) },
		workspace: {
			openLinkText: async () => undefined,
		},
	};
	let failed = false;
	try {
		await openQuestionSource(app as never, bankFile() as never, item);
	} catch {
		failed = true;
	}
	assert(!failed, "缺少 getLeavesOfType 时应安静退化成只打开文件");
});
