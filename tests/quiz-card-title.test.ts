/**
 * 题目标题的 Markdown 渲染。
 *
 * 标题文字来自笔记里的分级标题（或数据块里的 `question` 字段）。题面、选项、解析
 * 早就交给 `MarkdownRenderer` 了，标题一度还是纯文本，于是 `**加粗**`、`*斜体*`
 * 会连标记一起显示在标题行上。这里钉住三件事：标题原文送进渲染器；渲染结果直接
 * 显示；渲染器没有产出时退回原文，标题不会变成空白。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

const { document } = setupDom();

import { contentHash } from "../src/hash";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { QuizQuestion } from "../src/types";
import { renderQuizCard } from "../src/view";
import { MarkdownRenderer } from "./obsidian-stub";
import { assert, assertEqual, must, test } from "./harness";

const options: ParseOptions = { deps: { parseYaml: (s) => yaml.load(s), hash: contentHash } };

/** 标题里带加粗、行内代码和斜体：三种标记都必须交给渲染器。 */
const MARKED_TITLE = [
	"---",
	"quiz: true",
	"---",
	"",
	"## **重点**：`TCP` 与 *UDP*",
	"",
	"下面哪个说法正确？",
	"",
	"- 甲 ^a",
	"- 乙 ^b",
	"",
	"```quiz",
	"type: single",
	"answer: a",
	"```",
].join("\n");

/** 数据块用 `question:` 换掉标题显示：它同样是作者写的 Markdown。 */
const CUSTOM_TITLE = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 简短的标题",
	"",
	"题面。",
	"",
	"- 甲 ^a",
	"- 乙 ^b",
	"",
	"```quiz",
	"type: single",
	"answer: a",
	"question: '**换掉**的标题'",
	"```",
].join("\n");

const TITLE_TEXT = "**重点**：`TCP` 与 *UDP*";

function parse(source: string): QuizQuestion {
	return must(parseQuizFile(source, "题库/测试.md", options).questions[0], "未解析出题目");
}

async function render(question: QuizQuestion): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
	} as unknown as Parameters<typeof renderQuizCard>[1]);
	return host;
}

/** 标题那次渲染调用：目标元素带标题的类名。 */
function titleCall(): { component: unknown; source: string; el: HTMLElement; path: string } | undefined {
	return MarkdownRenderer.calls.find((call) =>
		call.el.classList.contains("easy-quiz-card__title")
	);
}

function titleOf(host: HTMLElement): HTMLElement {
	return must(host.querySelector<HTMLElement>(".easy-quiz-card__title") ?? undefined, "题卡缺少标题");
}

/**
 * 临时把渲染器换成"真的会产出节点"的替身。
 *
 * 测试存根只记录调用、不产生 DOM，因此默认断言不到渲染结果；标题这一层要看的是
 * "渲染结果是否真的显示出来、标记是否被吃掉"，所以这里按 Obsidian 的产出来模拟：
 * 标题得到 `<p><strong>…<code>…<em>…</p>`，其余目标得到一段纯文本。
 */
function fakeRenderer(): () => void {
	const original = MarkdownRenderer.render.bind(MarkdownRenderer);
	MarkdownRenderer.render = async (_app, source, el) => {
		if (el.classList.contains("easy-quiz-card__title")) {
			const paragraph = el.createEl("p");
			paragraph.createEl("strong", { text: "重点" });
			paragraph.createSpan({ text: "：" });
			paragraph.createEl("code", { text: "TCP" });
			paragraph.createSpan({ text: " 与 " });
			paragraph.createEl("em", { text: "UDP" });
			return;
		}
		el.createEl("p", { text: source });
	};
	return () => {
		MarkdownRenderer.render = original;
	};
}

test("题卡标题：把标题原文交给 MarkdownRenderer", async () => {
	const question = parse(MARKED_TITLE);
	assertEqual(question.title, TITLE_TEXT, "解析出的标题保留 Markdown 标记");

	MarkdownRenderer.calls.length = 0;
	await render(question);

	const call = must(titleCall(), "题目标题应走 MarkdownRenderer");
	assertEqual(call.source, TITLE_TEXT, "送进渲染器的是标题原文，而不是剥掉标记的纯文本");
	assertEqual(call.path, "题库/测试.md", "以当前文件为相对路径基准");
	assert(call.component !== null && call.component !== undefined, "标题渲染同样需要 Component");
});

test("题卡标题：加粗、斜体与行内代码按渲染结果显示", async () => {
	const question = parse(MARKED_TITLE);
	const restore = fakeRenderer();
	try {
		const host = await render(question);
		const title = titleOf(host);

		assert(title.querySelector("strong") !== null, "加粗应显示为 <strong>");
		assert(title.querySelector("em") !== null, "斜体应显示为 <em>");
		assert(title.querySelector("code") !== null, "行内代码应显示为 <code>");
		assertEqual(title.textContent, "重点：TCP 与 UDP", "标题显示渲染后的文字");
		assert(!(title.textContent ?? "").includes("**"), "标记字符不应留在标题上");
	} finally {
		restore();
	}
});

test("题卡标题：渲染器没有产出时退回标题原文，标题不会变空", async () => {
	const question = parse(MARKED_TITLE);
	// 默认存根只记录调用、不产生节点：这正是"渲染失败"时的形态。
	MarkdownRenderer.calls.length = 0;
	const host = await render(question);
	assertEqual(titleOf(host).textContent, TITLE_TEXT, "没有渲染结果时应显示标题原文");
});

test("题卡标题：数据块的 question 字段同样按 Markdown 渲染", async () => {
	const question = parse(CUSTOM_TITLE);
	assertEqual(question.displayTitle, "**换掉**的标题", "displayTitle 优先于标题显示");

	MarkdownRenderer.calls.length = 0;
	await render(question);

	const call = must(titleCall(), "题目标题应走 MarkdownRenderer");
	assertEqual(call.source, "**换掉**的标题", "送进渲染器的是 question 字段原文");
});
