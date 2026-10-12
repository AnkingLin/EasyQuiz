/**
 * 插入题目模板与插入定位的测试。
 *
 * 模板的价值在于「插入后就能用」，因此这里不只比对字符串，而是把生成的骨架
 * 交给真实的解析器解析：题型正确、没有降级提示、答案能对上，才算通过。
 */

import * as yaml from "js-yaml";
import { buildQuestionTemplate, DEFAULT_TITLES, planInsertion, TemplateOptions } from "../src/insert";
import { contentHash } from "../src/hash";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { QUIZ_TYPES, QuizType } from "../src/types";
import { assert, assertEqual, at, must, test } from "./harness";

const deps: ParseOptions["deps"] = { parseYaml: (source) => yaml.load(source), hash: contentHash };

function template(type: QuizType, overrides: Partial<TemplateOptions> = {}): string {
	// `title` 显式传空串时不能被默认标题顶掉，因此这里单独判断是否为 undefined。
	const { title, ...rest } = overrides;
	return buildQuestionTemplate({
		type,
		title: title ?? DEFAULT_TITLES[type],
		headingLevel: 2,
		blockLanguage: "quiz",
		blankMarker: "highlight",
		...rest,
	});
}

/**
 * 把模板放进一份完整的题库文件里再解析。
 *
 * 这样才验证得到真实场景：文件有 frontmatter、模板前还有一个 H1 文件标题，
 * 题目必须仍然被正确切分出来。
 */
function parseInserted(markdown: string, options: Partial<ParseOptions> = {}) {
	const source = ["---", "quiz: true", "---", "", "# 测试题库", "", markdown, ""].join("\n");
	return parseQuizFile(source, "题库/插入测试.md", { deps, headingLevels: [2, 2], ...options });
}

// ---------------------------------------------------------------------------
// 模板：插入后即可作答
// ---------------------------------------------------------------------------

test("五种题型都提供默认标题", () => {
	for (const type of QUIZ_TYPES) {
		assert(DEFAULT_TITLES[type].trim() !== "", `题型 ${type} 缺少默认标题`);
	}
});

test("单选模板解析为可作答的单选题", () => {
	const parsed = parseInserted(template("single"));
	assertEqual(parsed.questions.length, 1, "应解析出一道题");
	const question = must(parsed.questions[0], "应有题目");
	assertEqual(question.ok, true, `单选模板不应降级，实际提示：${question.warnings.map((w) => w.message).join("；")}`);
	assertEqual(question.type, "single", "题型应为 single");
	assertEqual(question.options.length, 2, "应有两个选项");
	assertEqual(question.answer, at(question.options, 0).anchor ?? null, "答案应指向第一个选项的锚点");
});

test("多选模板解析为可作答的多选题", () => {
	const parsed = parseInserted(template("multi"));
	const question = must(parsed.questions[0], "应有题目");
	assertEqual(question.ok, true, `多选模板不应降级，实际提示：${question.warnings.map((w) => w.message).join("；")}`);
	assertEqual(question.type, "multi", "题型应为 multi");
	assertEqual(question.answerAnchors.length, 2, "两个选项都应有锚点");
	assert(Array.isArray(question.answer), "多选答案应为数组");
});

test("配对模板解析出两列且连线上有正确答案", () => {
	const parsed = parseInserted(template("match"));
	const question = must(parsed.questions[0], "应有题目");
	assertEqual(question.ok, true, `配对模板不应降级，实际提示：${question.warnings.map((w) => w.message).join("；")}`);
	assertEqual(question.type, "match", "题型应为 match");
	assertEqual(question.board.length, 2, "应有左右两列");
	assert(question.boardPairs.length > 0, "应至少有一条正确答案连线");
});

test("填空模板的空位可用，且样式跟随填空标记设置", () => {
	const highlight = must(parseInserted(template("blank")).questions[0], "应有题目");
	assertEqual(highlight.ok, true, `填空模板不应降级，实际提示：${highlight.warnings.map((w) => w.message).join("；")}`);
	assertEqual(highlight.blanks.length, 1, "应识别出一个空位");
	assertEqual(at(highlight.blanks, 0).expected, "答案", "空位答案应取自标记内文字");

	const bold = must(
		parseInserted(template("blank", { blankMarker: "bold" }), { blankMarker: "bold" }).questions[0],
		"应有题目"
	);
	assertEqual(bold.ok, true, "加粗模式下的填空模板不应降级");
	assertEqual(at(bold.blanks, 0).expected, "答案", "加粗模式同样应识别出空位");
});

test("问答模板解析为可作答的问答题", () => {
	const parsed = parseInserted(template("essay"));
	const question = must(parsed.questions[0], "应有题目");
	assertEqual(question.ok, true, `问答模板不应降级，实际提示：${question.warnings.map((w) => w.message).join("；")}`);
	assertEqual(question.type, "essay", "题型应为 essay");
	assert(question.body.includes("参考答案"), "题面应保留折叠的参考答案块");
});

test("每种题型都不产生降级提示", () => {
	for (const type of QUIZ_TYPES) {
		const question = must(parseInserted(template(type)).questions[0], `${type} 应有题目`);
		assertEqual(
			question.ok,
			true,
			`${type} 模板不应降级：${question.warnings.map((w) => `${w.code}/${w.message}`).join("；")}`
		);
	}
});

// ---------------------------------------------------------------------------
// 模板：标题与设置
// ---------------------------------------------------------------------------

test("题干标题使用设置里的层级", () => {
	assert(template("single", { headingLevel: 3 }).startsWith("### "), "应生成 H3 标题");
	const parsed = parseInserted(template("single", { headingLevel: 3 }), { headingLevels: [3, 3] });
	assertEqual(must(parsed.questions[0], "应有题目").level, 3, "解析出的标题层级应为 3");
});

test("标题层级被收敛到 1–6", () => {
	assert(template("single", { headingLevel: 0 }).startsWith("# "), "层级过小应取 1");
	assert(template("single", { headingLevel: 99 }).startsWith("###### "), "层级过大应取 6");
});

test("自定义标题去掉换行并保留正文", () => {
	const markdown = template("single", { title: "  TCP 握手  " });
	assert(markdown.startsWith("## TCP 握手"), `标题应被裁剪，实际：${markdown.split("\n")[0]}`);

	const multiline = template("single", { title: "第一行\n第二行" });
	assert(!multiline.includes("第一行\n第二行"), "标题中的换行应被折叠");
});

test("标题为空时回退到题型默认标题", () => {
	assert(template("blank", { title: "   " }).startsWith(`## ${DEFAULT_TITLES.blank}`), "空标题应回退到默认值");
});

test("标题末尾的知识点链接被保留，并原样解析回题目", () => {
	const markdown = template("single", { title: "三次握手 ^[[TCP 握手过程]]" });
	assert(markdown.startsWith("## 三次握手 ^[[TCP 握手过程]]"), `标题行应保留链接，实际：${markdown.split("\n")[0]}`);

	const question = must(parseInserted(markdown).questions[0], "应有题目");
	assertEqual(question.title, "三次握手", "题面标题不含链接");
	assertEqual(question.knowledgeLink, "TCP 握手过程", "知识点链接应被解析出来");
});

test("只写知识点链接的标题不回退到默认标题", () => {
	const markdown = template("single", { title: "^[[TCP 握手过程]]" });
	assert(markdown.startsWith("## ^[[TCP 握手过程]]"), `应保留链接，实际：${markdown.split("\n")[0]}`);
});

test("模板使用设置里的数据块语言", () => {
	const markdown = template("single", { blockLanguage: "easyquiz" });
	assert(markdown.includes("```easyquiz"), "应使用配置的数据块语言");
	assert(!markdown.includes("```quiz"), "不应混用默认语言");
});

// ---------------------------------------------------------------------------
// 插入定位：空行与光标
// ---------------------------------------------------------------------------

const sample = "## 题干";

/**
 * 造一个只读的编辑器读数。
 *
 * `doc` 的每一行就是一行文本；光标位置用行号与列号给出，与真实编辑器一致。
 */
function readout(doc: string, cursorLine: number, cursorCh: number) {
	const lines = doc.split("\n");
	const lineText = (line: number) => lines[line] ?? "";
	return {
		readout: {
			cursorLine,
			cursorCh,
			lineText,
			textBeforeCursor: () => lineText(cursorLine).slice(0, cursorCh),
		},
		lineCount: lines.length,
	};
}

function planAt(doc: string, line: number, ch: number, template = sample) {
	const { readout: point, lineCount } = readout(doc, line, ch);
	return planInsertion(template, point, lineCount);
}

test("文首插入：不加换行，光标停在标题末尾", () => {
	const plan = planAt("", 0, 0);
	assertEqual(plan.start.line, 0, "替换区间应从文首开始");
	assertEqual(plan.start.ch, 0, "替换区间应从行首开始");
	assertEqual(plan.text, sample, "文首没有相邻内容，不该补换行");
	assertEqual(plan.cursorOffset, "## 题干".length, "光标应落在标题末尾");
});

test("段末插入：与前一段之间正好一个空行", () => {
	const plan = planAt("已有正文", 0, 4);
	assertEqual(plan.start.line, 0, "替换区间从前一段所在行开始");
	assertEqual(plan.text, `已有正文\n\n${sample}`, "前一段与题目之间应正好一个空行");
	assertEqual(plan.cursorOffset, "已有正文\n\n".length + "## 题干".length, "光标偏移应包含前一段");
});

test("空行处插入：不新增空行", () => {
	const plan = planAt("第一段\n\n第二段", 1, 0);
	assertEqual(plan.start.line, 0, "替换区间从前一段所在行开始");
	assertEqual(plan.text, `第一段\n\n${sample}\n\n第二段`, "前后各正好一个空行");
});

test("多处连续空行：被收成一个空行", () => {
	const plan = planAt("第一段\n\n\n\n第二段", 2, 0);
	assertEqual(plan.text, `第一段\n\n${sample}\n\n第二段`, "成串空行应被收成一个");
});

test("行中插入：把该行切成两段", () => {
	const plan = planAt("前半后半", 0, 2);
	assertEqual(plan.start.line, 0, "替换区间从该行行首开始");
	assertEqual(plan.end.line, 0, "替换区间到该行行尾结束");
	assertEqual(plan.text, `前半\n\n${sample}\n\n后半`, "两侧都应留出一个空行");
});

test("文末插入：不补尾随换行", () => {
	const plan = planAt("已有正文", 0, 4);
	assert(!plan.text.endsWith("\n"), "文末补换行会留下多余空行");
});

test("文件末尾以空行结尾：空行被吸进替换区间", () => {
	const plan = planAt("已有正文\n\n", 2, 0);
	assertEqual(plan.text, `已有正文\n\n${sample}`, "结尾空行不应留在题目之后");
	assertEqual(plan.end.line, 2, "替换区间应覆盖到文件末尾");
});

test("光标在空行行首时不会吞掉前一行", () => {
	const plan = planAt("第一段\n\n第二段", 1, 0);
	assertEqual(plan.start.line, 0, "应从第一段开始替换，不能把第一段吞掉");
	assertEqual(plan.start.ch, 0, "替换应从行首开始");
});

test("文末的空行：被吸进替换区间，不会越积越多", () => {
	const plan = planAt("已有正文\n\n\n", 3, 0);
	assertEqual(plan.text, `已有正文\n\n${sample}`, "结尾空行应被收掉");
	assertEqual(plan.start.line, 0, "替换区间应从前一段开始");
	assertEqual(plan.end.line, 3, "替换区间应覆盖到文件末尾");
});

test("标点与锚点原样保留", () => {
	const template = "## 题干\n\n- 选项 ^a\n\n```quiz\ntype: single\nanswer: a\n```";
	const plan = planAt("前文", 0, 2, template);
	assert(plan.text.includes("- 选项 ^a"), "选项锚点不应被改写");
	assert(plan.text.includes("answer: a"), "数据块内容不应被改写");
});

test("没有换行的模板光标落在末尾", () => {
	const plan = planAt("", 0, 0, "## 只有标题");
	assertEqual(plan.cursorOffset, "## 只有标题".length, "光标应落在整段末尾");
});
