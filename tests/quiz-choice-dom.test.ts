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

/** 部分选项写了锚点：中间那个没有锚点，因此不会渲染到题面上。 */const PARTIAL = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 部分锚点",
	"",
	"- 选项甲 ^a",
	"- 选项乙",
	"- 选项丙 ^c",
	"",
	"```quiz",
	"type: single",
	"answer: a",
	"```",
].join("\n");

/** 解析里带 Markdown 标记：复盘时必须按原文渲染。 */
const EXPLAINED = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 解析渲染",
	"",
	"题面。",
	"",
	"- 甲 ^a",
	"- 乙 ^b",
	"",
	"```quiz",
	"type: single",
	"answer: a",
	"explanation: \"**粗体** 与 `行内代码`\"",
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

test("DOM：部分选项缺省锚点时，无锚点的选项从题面隐藏", async () => {
	const question = parse(PARTIAL);
	assertEqual(question.ok, true, "部分缺省不应降级");

	MarkdownRenderer.calls.length = 0;
	const host = await render(question);
	const rows = [...host.querySelectorAll<HTMLElement>(".easy-quiz-card__option")];
	assertEqual(rows.length, 2, "只渲染有锚点的选项");
	assertEqual(
		rows.map((row) => row.getAttribute("data-anchor")).join(","),
		"a,c",
		"渲染出来的选项都应带锚点"
	);
	assert(
		!optionSources().some((source) => source.includes("选项乙")),
		`无锚点的选项不应进入题面（实际：${JSON.stringify(optionSources())}）`
	);

	const first = must(rows[0], "缺少第一个选项");
	first.click();
	assert(first.classList.contains("is-selected"), "有锚点的选项应能选中");
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

/** 解析正文同样是作者写的 Markdown：复盘区必须把它交给渲染器，而不是当成纯文本。 */
test("DOM：解析按 Markdown 原文渲染（复盘态）", async () => {
	MarkdownRenderer.calls.length = 0;
	const host = await render(parse(EXPLAINED), { reviewOnly: true });

	const call = MarkdownRenderer.calls.find((item) =>
		item.el.classList.contains("easy-quiz-card__review-text")
	);
	const review = must(call, "解析应交给 MarkdownRenderer 渲染");
	assertEqual(review.source, "**粗体** 与 `行内代码`", "解析应使用作者写的原文");

	// 渲染器替身不生成 DOM：解析必须退回纯文本，不能整段消失。
	const body = must(
		host.querySelector<HTMLElement>(".easy-quiz-card__review-text") ?? undefined,
		"复盘区应有解析正文"
	);
	assert((body.textContent ?? "").includes("粗体"), `解析退化为纯文本后仍应可读（实际：${body.textContent}）`);
});
