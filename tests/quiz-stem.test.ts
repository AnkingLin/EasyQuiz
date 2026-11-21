/**
 * 题面预处理测试。
 *
 * 这一层负责修掉"题目内容被渲染两次"的问题：选项列表、配对表格由交互控件渲染，
 * 题面里必须去掉；填空的 `==答案==` 则换成占位标记，交给可点击的空位输入框。
 */

import * as yaml from "js-yaml";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { contentHash } from "../src/hash";
import { BLANK_MARKER_PREFIX, dropTopLevelLists, dropTables, formatStem } from "../src/stem";
import { QuizQuestion } from "../src/types";
import { assert, assertEqual, at, test } from "./harness";

const options: ParseOptions = {
	deps: { parseYaml: (source) => yaml.load(source), hash: contentHash },
};

function parse(source: string, extra: Partial<ParseOptions> = {}): QuizQuestion {
	const result = parseQuizFile(source, "题库/测试.md", { ...options, ...extra });
	return at(result.questions, 0, "未解析出题目");
}

// ---------------------------------------------------------------------------
// 选择题：选项不能出现在题面里
// ---------------------------------------------------------------------------

const singleSource = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 三次握手",
	"",
	"建立连接需要几次握手？",
	"",
	"- 一次 ^a",
	"- 三次 ^c",
	"- 四次 ^d",
	"",
	"```quiz",
	"type: single",
	"answer: c",
	"```",
].join("\n");

test("选择题：题面保留题干，去掉选项列表", () => {
	const stem = formatStem(parse(singleSource));
	assert(stem.includes("建立连接需要几次握手？"), `应保留题干（实际：${JSON.stringify(stem)}）`);
	assert(!stem.includes("一次"), "选项不应出现在题面里");
	assert(!stem.includes("三次"), "选项不应出现在题面里");
	assert(!stem.includes("- "), "列表标记不应出现在题面里");
});

test("选择题：题面不残留选项锚点", () => {
	const stem = formatStem(parse(singleSource));
	assert(!stem.includes("^a"), "不应残留锚点 ^a");
	assert(!stem.includes("^c"), "不应残留锚点 ^c");
});

test("多选题：同样去掉选项列表", () => {
	const stem = formatStem(
		parse(
			[
				"---",
				"quiz: true",
				"---",
				"",
				"## 传输层协议",
				"",
				"哪些属于传输层？",
				"",
				"- TCP ^a",
				"- IP ^c",
				"",
				"```quiz",
				"type: multi",
				"answer: [a]",
				"```",
			].join("\n")
		)
	);
	assert(stem.includes("哪些属于传输层？"), "应保留题干");
	assert(!stem.includes("TCP"), "选项不应出现在题面里");
});

// ---------------------------------------------------------------------------
// 配对题：表格不能出现在题面里
// ---------------------------------------------------------------------------

test("配对题：题面去掉表格，保留题干", () => {
	const stem = formatStem(
		parse(
			[
				"---",
				"quiz: true",
				"---",
				"",
				"## 配对",
				"",
				"把协议和端口连起来。",
				"",
				"| 协议 | 端口 |",
				"| --- | --- |",
				"| HTTP | 80 |",
				"| SSH | 22 |",
				"",
				"```quiz",
				"type: match",
				"```",
			].join("\n")
		)
	);
	assert(stem.includes("把协议和端口连起来。"), `应保留题干（实际：${JSON.stringify(stem)}）`);
	assert(!stem.includes("|"), "表格不应出现在题面里");
	assert(!stem.includes("HTTP"), "表格内容不应出现在题面里");
});

// ---------------------------------------------------------------------------
// 填空题：空位换成可交互占位标记
// ---------------------------------------------------------------------------

test("填空题：每个空位替换成占位标记，且答案不泄露", () => {
	const question = parse(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 首部字段",
			"",
			"最小长度是 ==20== ^b1 字节，其中 ==序号== ^b2 字段标识首字节。",
			"",
			"```quiz",
			"type: blank",
			"```",
		].join("\n")
	);
	const stem = formatStem(question);
	assert(stem.includes(`${BLANK_MARKER_PREFIX}b1`), `应含 b1 占位（实际：${JSON.stringify(stem)}）`);
	assert(stem.includes(`${BLANK_MARKER_PREFIX}b2`), "应含 b2 占位");
	assert(!stem.includes("==20=="), "答案不应出现在题面里");
	assert(!stem.includes("20"), "答案文本不应出现在题面里");
	assert(stem.includes("字节"), "空位周围的正文应保留");
	assertEqual(question.blanks.length, 2, "应识别出两个空位");
});

test("填空题：占位标记用内联代码包裹，便于渲染后定位", () => {
	const stem = formatStem(
		parse(
			[
				"---",
				"quiz: true",
				"---",
				"",
				"## 题",
				"",
				"答案是 ==甲== ^b1 结束。",
				"",
				"```quiz",
				"type: blank",
				"```",
			].join("\n")
		)
	);
	assert(stem.includes(`\`${BLANK_MARKER_PREFIX}b1\``), `占位应是内联代码（实际：${JSON.stringify(stem)}）`);
});

// ---------------------------------------------------------------------------
// 非填空题的高亮：保留文字
// ---------------------------------------------------------------------------

test("问答题：高亮保留文字，只去掉等号与锚点", () => {
	const stem = formatStem(
		parse(
			[
				"---",
				"quiz: true",
				"---",
				"",
				"## 题",
				"",
				"请说明 ==三次握手== 的作用。",
				"",
				"```quiz",
				"type: essay",
				"```",
			].join("\n")
		)
	);
	assert(stem.includes("三次握手"), `高亮文字应保留（实际：${JSON.stringify(stem)}）`);
	assert(!stem.includes("=="), "等号应去掉");
});

test("问答题：正文原样保留", () => {
	const stem = formatStem(
		parse(
			[
				"---",
				"quiz: true",
				"---",
				"",
				"## 题",
				"",
				"第一段。",
				"",
				"> [!question]- 参考答案",
				"> 参考内容。",
				"",
				"```quiz",
				"type: essay",
				"```",
			].join("\n")
		)
	);
	assert(stem.includes("第一段。"), "正文应保留");
	assert(stem.includes("[!question]- 参考答案"), "折叠参考答案应保留");
});

// ---------------------------------------------------------------------------
// 知识点链接
// ---------------------------------------------------------------------------

test("知识点链接：题面正文里的 [[链接]] 原样保留，不被当作锚点删掉", () => {
	const stem = formatStem(
		parse(
			[
				"---",
				"quiz: true",
				"---",
				"",
				"## 三次握手 ^[[TCP 握手过程]]",
				"",
				"参见 [[TCP 首部格式]] 后作答。",
				"",
				"- 一次 ^a",
				"- 三次 ^c",
				"",
				"```quiz",
				"type: single",
				"answer: c",
				"```",
			].join("\n")
		)
	);
	assert(stem.includes("[[TCP 首部格式]]"), `正文链接应原样保留（实际：${JSON.stringify(stem)}）`);
	assert(!stem.includes("^c"), "选项锚点仍应删除");
});

test("知识点链接：标题末尾的 ^[[知识点]] 不进入题面正文", () => {
	const stem = formatStem(parse(singleSource.replace("## 三次握手", "## 三次握手 ^[[TCP 握手过程]]")));
	assert(!stem.includes("知识点"), "标题里的链接不应出现在正文里");
	assert(!stem.includes("[["), `不应残留双链（实际：${JSON.stringify(stem)}）`);
	assert(stem.includes("建立连接需要几次握手？"), "题干应保留");
});

// ---------------------------------------------------------------------------
// 纯函数边界
// ---------------------------------------------------------------------------

test("dropTopLevelLists：代码块内的列表标记不动", () => {
	const source = ["说明：", "", "```text", "- 这不是选项", "```", "", "- 这才是选项"].join("\n");
	const result = dropTopLevelLists(source);
	assert(result.includes("- 这不是选项"), "代码块内容应保留");
	assert(!result.includes("- 这才是选项"), "顶层列表项应删除");
});

test("dropTopLevelLists：有序列表同样删除", () => {
	const result = dropTopLevelLists(["题干", "", "1. 第一项", "2. 第二项"].join("\n"));
	assert(!result.includes("第一项"), "有序列表项应删除");
	assert(result.includes("题干"), "题干应保留");
});

test("dropTables：只删除表格行", () => {
	const source = ["题干。", "", "| 甲 | 乙 |", "| --- | --- |", "| 1 | 2 |", "", "结尾。"].join("\n");
	const result = dropTables(source);
	assert(!result.includes("|"), "表格行应删除");
	assert(result.includes("题干。"), "题干应保留");
	assert(result.includes("结尾。"), "表格后的正文应保留");
});

// ---------------------------------------------------------------------------
// 空位映射：代码示例、混合标记与嵌套标记
// ---------------------------------------------------------------------------

test("填空题：行内代码里的标记不算空位，占位符不会落到代码里", () => {
	const question = parse(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 题",
			"",
			"行内示例 `==不是空位==`，正文里 ==是空位==。",
			"",
			"```quiz",
			"type: blank",
			"```",
		].join("\n")
	);
	assertEqual(question.blanks.length, 1, "只应识别出一个空位");
	assertEqual(question.blanks[0]?.anchor, "b1", "真实空位的锚点");
	const stem = formatStem(question);
	assert(stem.includes("`==不是空位==`"), `代码示例应原样保留（实际：${JSON.stringify(stem)}）`);
	assert(stem.includes(`${BLANK_MARKER_PREFIX}b1`), "真实空位应替换成占位符");
	assert(!stem.includes(`${BLANK_MARKER_PREFIX}b2`), "不应出现第二个占位符");
	assertEqual(
		(stem.match(new RegExp(BLANK_MARKER_PREFIX, "g")) ?? []).length,
		1,
		"占位符应只出现一次"
	);
});

test("填空题：both 模式下两种标记按出现顺序对应", () => {
	const question = parse(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 题",
			"",
			"**加粗** 与 ==高亮== 都是空位。",
			"",
			"```quiz",
			"type: blank",
			"```",
		].join("\n"),
		{ blankMarker: "both" }
	);
	assertEqual(question.blanks.map((blank) => blank.anchor).join(","), "b1,b2", "两个空位");
	const stem = formatStem(question, "both");
	const first = stem.indexOf(`${BLANK_MARKER_PREFIX}b1`);
	const second = stem.indexOf(`${BLANK_MARKER_PREFIX}b2`);
	assert(first >= 0 && second > first, `b1 应在 b2 之前（实际：${JSON.stringify(stem)}）`);
});

test("填空题：嵌套标记只算一个空位，答案去掉装饰", () => {
	const question = parse(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 题",
			"",
			"答案是 ==**20**== 字节。",
			"",
			"```quiz",
			"type: blank",
			"```",
		].join("\n"),
		{ blankMarker: "both" }
	);
	assertEqual(question.blanks.length, 1, "嵌套标记只应算一个空位");
	assertEqual(question.blanks[0]?.expected, "20", "答案应去掉加粗装饰");
});

test("选择题：题干上方的材料列表会显示在题面里", () => {
	const question = parse(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 题",
			"",
			"材料：",
			"",
			"- 材料一",
			"- 材料二",
			"",
			"- 选项A ^a",
			"- 选项B ^b",
			"",
			"```quiz",
			"type: single",
			"answer: a",
			"```",
		].join("\n")
	);
	const stem = formatStem(question);
	assert(stem.includes("材料一"), `材料列表应保留（实际：${JSON.stringify(stem)}）`);
	assert(stem.includes("材料二"), "材料列表应保留");
});
