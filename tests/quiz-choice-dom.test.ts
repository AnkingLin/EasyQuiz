/**
 * 选择题选项的渲染测试（jsdom）。
 *
 * 钉住一件曾经出错、而且"用户一眼能看见"的事：**选项按 Markdown 原文渲染。**
 * 选项文本一度取自 `QuizOption.text`，那是给匹配用的规范化结果（会删掉 `* _ ` ~`），
 * 于是 `H~2~O` 在卡片上显示成 `H2O`、`~5%` 显示成 `5%`。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

const { document } = setupDom();

import { parseQuizFile, ParseOptions } from "../src/parser";
import { contentHash } from "../src/hash";
import { renderQuizCard } from "../src/view";
import { QuizQuestion } from "../src/types";
import { MarkdownRenderer } from "./obsidian-stub";
import { assert, assertEqual, must, test } from "./harness";

const options: ParseOptions = { deps: { parseYaml: (s) => yaml.load(s), hash: contentHash } };

function parse(source: string): QuizQuestion {
	return must(parseQuizFile(source, "题库/测试.md", options).questions[0], "未解析出题目");
}

/** 一道含 `~` 等 Markdown 标记的单选题：正确答案是 c。 */
const TILDE = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 估算",
	"",
	"下面哪个写法是对的？",
	"",
	"- 约 ~5% ^a",
	"- H~2~O ^b",
	"- **正确**项 ^c",
	"",
	"```quiz",
	"type: single",
	"answer: c",
	"```",
].join("\n");

async function render(
	question: QuizQuestion,
	extra: Partial<Parameters<typeof renderQuizCard>[1]> = {}
): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
		...extra,
	} as unknown as Parameters<typeof renderQuizCard>[1]);
	return host;
}

/** 取选项外层文字（渲染器替身不产生 HTML，因此读的是它的输入源码）。 */
function optionSources(): string[] {
	return MarkdownRenderer.calls
		.filter((call) => call.el.classList.contains("easy-quiz-card__option-text"))
		.map((call) => call.source);
}

test("DOM：选项按 Markdown 原文渲染，`~` 不会被吃掉", async () => {
	MarkdownRenderer.calls.length = 0;
	await render(parse(TILDE));

	const sources = optionSources();
	assertEqual(sources.length, 3, `应有三个选项送进渲染器（实际 ${sources.length} 个）`);
	assert(sources.includes("约 ~5%"), `第一个选项应保留 ~（实际：${JSON.stringify(sources)}）`);
	assert(sources.includes("H~2~O"), `下标写法应原样保留（实际：${JSON.stringify(sources)}）`);
	assert(sources.includes("**正确**项"), "加粗标记应交给渲染器，而不是提前剥掉");
});

/**
 * 选项文本的**纯文本**形态仍然是为匹配而规范化的，因此不能拿它去显示。
 * 这里把两者的区别钉住：`text` 里没有 `~`，`markdown` 里有。
 */
test("DOM：选项的 markdown 与 text 分工不同（text 供匹配、markdown 供显示）", () => {
	const question = parse(TILDE);
	const first = must(question.options[0], "应有第一个选项");
	assertEqual(first.markdown, "约 ~5%", "markdown 保留原文");
	assert(!first.text.includes("~"), `text 为匹配做过规范化（实际：${JSON.stringify(first.text)}）`);
});

test("DOM：选项里的锚点不会进入渲染内容", async () => {
	MarkdownRenderer.calls.length = 0;
	await render(parse(TILDE));
	for (const source of optionSources()) {
		assert(!source.includes("^a") && !source.includes("^b") && !source.includes("^c"), `锚点不应渲染出来（实际：${source}）`);
	}
});

/** 选项与题面共用同一个 Component：少传或各建一份都会让 Obsidian 报错/泄漏。 */
test("DOM：题面与选项用的是同一个 Component", async () => {
	MarkdownRenderer.calls.length = 0;
	await render(parse(TILDE));
	assert(MarkdownRenderer.calls.length >= 4, "题面 + 三个选项都应走渲染器");
	const used = new Set(MarkdownRenderer.calls.map((call) => call.component));
	assertEqual(used.size, 1, "整张卡片只应有一个 Component");
	for (const call of MarkdownRenderer.calls) {
		assert(call.component !== null && call.component !== undefined, "Component 不能为空");
	}
});
