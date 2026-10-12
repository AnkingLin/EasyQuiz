/**
 * 知识点链接的 DOM 测试（jsdom）。
 *
 * 题面标题末尾的 `^[[知识点]]` 在解析层被摘出成 `knowledgeLink`，这一层验证它真的被渲染成
 * 题卡头部的可点击链接，并且点击走 Obsidian 自己的链接处理（`openLinkText`）。
 * 顺带覆盖"宿主 App 缺少 workspace/metadataCache"时不抛错的退化路径。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

const { window: testWindow, document } = setupDom();

import { parseQuizFile, ParseOptions } from "../src/parser";
import { contentHash } from "../src/hash";
import { renderQuizCard, splitWikiTarget } from "../src/view";
import { QuizQuestion } from "../src/types";
import { assert, assertEqual, must, test } from "./harness";

const options: ParseOptions = { deps: { parseYaml: (s) => yaml.load(s), hash: contentHash } };

/** 解析一道带知识点链接的单选题。 */
function parseWithLink(heading: string): QuizQuestion {
	const source = [
		"---",
		"quiz: true",
		"---",
		"",
		heading,
		"",
		"- 一次 ^a",
		"- 三次 ^c",
		"",
		"```quiz",
		"type: single",
		"answer: c",
		"```",
	].join("\n");
	const question = must(parseQuizFile(source, "题库/测试.md", options).questions[0], "未解析出题目");
	return question;
}

/** 记录 openLinkText 调用的假 App；resolved 用来模拟 metadataCache 的短链接解析。 */
function fakeApp(resolved: string | null = null) {
	const calls: { linktext: string; sourcePath: string }[] = [];
	const app = {
		metadataCache: {
			getFirstLinkpathDest: (linkpath: string) =>
				resolved === null ? null : { path: `${linkpath}.md`, basename: linkpath },
			fileToLinktext: () => resolved ?? "",
		},
		workspace: {
			openLinkText: async (linktext: string, sourcePath: string) => {
				calls.push({ linktext, sourcePath });
			},
		},
	};
	return { app, calls };
}

async function render(question: QuizQuestion, app: unknown): Promise<HTMLElement> {
	const card = document.createElement("div");
	document.body.appendChild(card);
	await renderQuizCard(question, {
		app,
		service: {},
		file: { path: "题库/测试.md" },
		el: card,
		blankMarker: "highlight",
	} as unknown as Parameters<typeof renderQuizCard>[1]);
	return card;
}

// ---------------------------------------------------------------------------
// 纯函数：wikilink 拆解
// ---------------------------------------------------------------------------

test("splitWikiTarget：路径 + 小标题", () => {
	const parts = splitWikiTarget("计算机网络/传输层#TCP 三次握手");
	assertEqual(parts.target, "计算机网络/传输层", "目标路径");
	assertEqual(parts.subpath, "TCP 三次握手", "小标题");
	assertEqual(parts.label, "计算机网络/传输层#TCP 三次握手", "没有别名时显示原文");
});

test("splitWikiTarget：别名优先作为显示文字", () => {
	const parts = splitWikiTarget("计算机网络/传输层#TCP 三次握手|三次握手");
	assertEqual(parts.label, "三次握手", "显示文字取别名");
	assertEqual(parts.target, "计算机网络/传输层", "别名不影响目标");
});

test("splitWikiTarget：`[[#标题]]` 是本文件内的标题，没有目标文件", () => {
	const parts = splitWikiTarget("#TCP 三次握手");
	assertEqual(parts.target, "", "没有目标文件");
	assertEqual(parts.subpath, "TCP 三次握手", "小标题");
});

// ---------------------------------------------------------------------------
// 题卡渲染
// ---------------------------------------------------------------------------

test("题卡头部渲染知识点链接，题面标题不带链接", async () => {
	const question = parseWithLink("## 三次握手 ^[[计算机网络/传输层#TCP 三次握手]]");
	const { app } = fakeApp();
	const card = await render(question, app);

	const title = card.querySelector(".easy-quiz-card__title");
	assertEqual(title?.textContent, "三次握手", "题面标题");

	const link = must(
		card.querySelector<HTMLAnchorElement>(".easy-quiz-card__knowledge-link") ?? undefined,
		"应渲染知识点链接"
	);
	assertEqual(link.textContent, "计算机网络/传输层#TCP 三次握手", "链接文字");
});

test("没有知识点链接的题目不渲染这一行", async () => {
	const question = parseWithLink("## 三次握手");
	const { app } = fakeApp();
	const card = await render(question, app);
	assertEqual(card.querySelector(".easy-quiz-card__knowledge"), null, "不应渲染知识点行");
});

test("点击知识点链接会用 Obsidian 的链接处理打开笔记", async () => {
	const question = parseWithLink("## 三次握手 ^[[计算机网络/传输层#TCP 三次握手]]");
	const { app, calls } = fakeApp();
	const card = await render(question, app);

	const link = card.querySelector(".easy-quiz-card__knowledge-link") as HTMLAnchorElement;
	link.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true, cancelable: true }));
	await Promise.resolve();

	assertEqual(calls.length, 1, "应调用一次 openLinkText");
	assertEqual(calls[0]?.linktext, "计算机网络/传输层#TCP 三次握手", "应传链接原文");
	assertEqual(calls[0]?.sourcePath, "题库/测试.md", "应以当前文件为相对路径基准");
});

test("宿主缺少 workspace 时渲染知识点链接不抛错", async () => {
	const question = parseWithLink("## 三次握手 ^[[计算机网络/传输层#TCP 三次握手]]");
	const card = await render(question, {});
	const link = card.querySelector(".easy-quiz-card__knowledge-link") as HTMLAnchorElement;
	link.dispatchEvent(new testWindow.MouseEvent("click"));
	await Promise.resolve();
	assert(link !== null, "链接仍应渲染出来");
});
