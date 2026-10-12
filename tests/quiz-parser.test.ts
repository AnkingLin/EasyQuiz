/**
 * 解析器测试。
 *
 * 覆盖：文件识别、五种题型的正常路径、以及 README §2.6 的全部降级路径。
 * 断言基于「能观察到的行为」（ok / type / 结构 / 提示码），不依赖实现细节；
 * 每个降级用例使用独立的小题库，避免用例之间因下标耦合而互相影响。
 */

import * as yaml from "js-yaml";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { ParsedQuizFile, QuizQuestion } from "../src/types";
import { contentHash } from "../src/hash";
import { assert, assertEqual, at, must, test } from "./harness";
import fixture from "./fixtures/basic-quiz.md";

// ---------------------------------------------------------------------------
// 被测对象
// ---------------------------------------------------------------------------

const baseOptions: ParseOptions = {
	deps: { parseYaml: (source) => yaml.load(source), hash: contentHash },
};

function parse(source: string, options: Partial<ParseOptions> = {}): ParsedQuizFile {
	return parseQuizFile(source, "题库/测试.md", { ...baseOptions, ...options });
}

/** 取第一道题，失败时给出可诊断的信息（而不是 TypeError）。 */
function first(source: string, options: Partial<ParseOptions> = {}): QuizQuestion {
	const result = parse(source, options);
	assert(result.questions.length > 0, `未解析出任何题目（questions=${result.questions.length}）`);
	return must(result.questions[0], '应有题目');
}

/** 用标题定位题目，与顺序无关。 */
function byTitle(result: ParsedQuizFile, title: string): QuizQuestion {
	const question = result.questions.find((item) => item.title === title);
	assert(question !== undefined, `未找到标题为「${title}」的题目，实际标题：${result.questions.map((q) => q.title).join(" | ")}`);
	return question!;
}

function warnCodes(question: QuizQuestion): string {
	return question.warnings.map((warning) => warning.code).join(",");
}

function hasWarning(question: QuizQuestion, code: string): boolean {
	return question.warnings.some((warning) => warning.code === code);
}

const file = parse(fixture);

// ---------------------------------------------------------------------------
// 文件级
// ---------------------------------------------------------------------------

test("frontmatter quiz: true 被识别为题库文件", () => {
	assertEqual(file.fileIsQuiz, true, "应识别为题库文件");
	assertEqual(file.detectedBy, "frontmatter-quiz", "识别依据");
	assertEqual(file.schemaVersion, 1, "schemaVersion");
});

test("#quiz 标签可作为识别依据", () => {
	assertEqual(parse("正文\n", { tags: ["#quiz"] }).detectedBy, "tag", "识别依据");
});

test("路径通配符可作为识别依据", () => {
	assertEqual(parse("正文\n", { pathMatched: true }).detectedBy, "path-glob", "识别依据");
});

test("普通笔记不被识别为题库文件，也不产出题目", () => {
	const result = parse("# 标题\n\n正文\n");
	assertEqual(result.fileIsQuiz, false, "不应识别为题库文件");
	assertEqual(result.questions.length, 0, "题目数量");
});

test("h1 不在题面层级区间内，不产生题目", () => {
	assert(
		file.questions.every((question) => question.level >= 2 && question.level <= 4),
		`所有题目标题层级应在 2–4，实际：${file.questions.map((q) => q.level).join(",")}`
	);
	assertEqual(file.questions.length, 15, "题目数量");
});

test("文件级无提示：不存在游离的数据块", () => {
	const fileWarnings = file.warnings.filter((warning) => warning.questionIndex === null);
	assertEqual(fileWarnings.length, 0, `不应有文件级提示，实际 ${JSON.stringify(fileWarnings)}`);
});

// ---------------------------------------------------------------------------
// 单选题
// ---------------------------------------------------------------------------

test("单选题：结构、选项锚点与答案", () => {
	const question = byTitle(file, "TCP 建立连接需要几次握手？");
	assertEqual(question.ok, true, `应解析成功（warnings=${warnCodes(question)}）`);
	assertEqual(question.type, "single", "题型");
	assertEqual(question.options.length, 4, "选项数量");
	assertEqual(at(question.options, 2).anchor, "c", "第三个选项锚点");
	assertEqual(at(question.options, 2).text, "三次", "第三个选项文本");
	assertEqual(question.answer, "c", "答案");
	assertEqual(question.answerAnchors.join(","), "a,b,c,d", "可用锚点");
	assertEqual(question.explanation, "三次握手用于同步双方的初始序列号。", "解析文本");
});

test("单选题：插件写入的 stats / history 被读回", () => {
	const question = byTitle(file, "TCP 建立连接需要几次握手？");
	assertEqual(question.stats.attempts, 12, "attempts");
	assertEqual(question.stats.correct, 9, "correct");
	assertEqual(question.stats.lastResult, "correct", "lastResult");
	assertEqual(question.history.length, 2, "history 条数");
	assertEqual(at(question.history, 1).answer, "b", "第二次作答答案");
	assertEqual(at(question.history, 1).ms, 6100, "第二次作答耗时");
});

test("单选题：rev 与当前题面不一致时标记为 stale", () => {
	const question = byTitle(file, "TCP 建立连接需要几次握手？");
	assertEqual(question.rev, "stale-hash-for-test", "rev 应读回");
	assertEqual(question.stale, true, "题面与 rev 不一致应标记 stale");
});

test("单选题：id 显式给出时不由标题派生", () => {
	assertEqual(byTitle(file, "TCP 建立连接需要几次握手？").idDerived, false, "显式 id 不应视为派生");
	assertEqual(byTitle(file, "TCP 建立连接需要几次握手？").id, "tcp-handshake", "id");
});

test("id 派生：缺省 id 由标题生成并标记为派生", () => {
	const question = byTitle(file, "下列哪些属于传输层协议？");
	assertEqual(question.idDerived, true, "应标记为派生 id");
	assertEqual(question.id, "下列哪些属于传输层协议", "派生 id 应等于标题");
});

test("未写 rev 的题目不算 stale", () => {
	assertEqual(byTitle(file, "下列哪些属于传输层协议？").stale, false, "不应标记 stale");
});

// ---------------------------------------------------------------------------
// 多选题
// ---------------------------------------------------------------------------

test("多选题：答案是锚点数组，shuffle 生效", () => {
	const question = byTitle(file, "下列哪些属于传输层协议？");
	assertEqual(question.ok, true, `应解析成功（warnings=${warnCodes(question)}）`);
	assertEqual(question.options.length, 4, "选项数量");
	assertEqual(Array.isArray(question.answer), true, "答案应为数组");
	assertEqual((question.answer as string[]).join(","), "a,b", "答案锚点");
	assertEqual(question.shuffle, true, "shuffle");
});

// ---------------------------------------------------------------------------
// 配对题
// ---------------------------------------------------------------------------

test("配对题：表格按行给出正确答案，answer 不需要", () => {
	const question = byTitle(file, "将协议与其默认端口配对");
	assertEqual(question.ok, true, `应解析成功（warnings=${warnCodes(question)}）`);
	assertEqual(question.type, "match", "题型");
	assertEqual(question.table?.length, 3, "数据行数量");
	assertEqual(question.table?.[0]?.join("|"), "HTTP|80", "第一行");
	assertEqual(question.answer, null, "配对题不应有 answer");
});

test("配对题：每个条目都带可接受答案与稳定 key", () => {
	const question = byTitle(file, "将协议与其默认端口配对");
	assertEqual(question.matchItems.length, 3, "条目数量");
	assertEqual(at(question.matchItems, 0).text, "HTTP", "第一个条目的待匹配文本");
	assertEqual(at(question.matchItems, 0).actualTargets.join("/"), "80", "第一个条目的可接受答案");
	assert(
		question.matchItems.every((item) => /^[0-9a-f]+-\d+#\d+\.\d+\.\d+$/.test(item.key)),
		`key 应形如 hash-行#列.答案条目.左侧条目，实际：${question.matchItems.map((i) => i.key).join(",")}`
	);
});

test("配对题一对多：单元格内 ` / ` 拆成多个条目且答案相同", () => {
	const question = byTitle(file, "将数据库与其类型配对（一对多）");
	assertEqual(question.type, "match", "题型");
	assertEqual(
		question.matchItems.length,
		4,
		`条目数量应为 4（实际：${JSON.stringify(question.matchItems.map((i) => `${i.text}→${i.actualTargets.join("+")}`))}）`
	);
	const relation = question.matchItems.filter((item) => item.actualTargets.includes("关系型"));
	assertEqual(relation.length, 2, "「关系型」应有 2 个待匹配条目（MySQL、PostgreSQL）");
	assertEqual(at(relation, 0).text, "MySQL", "第一个条目");
	assertEqual(at(relation, 1).text, "PostgreSQL", "第二个条目");
	// 合并选项：两个条目都可接受同一答案。
	assertEqual(at(relation, 0).actualTargets.join("/"), "关系型", "第一个条目的可接受答案");
	assertEqual(at(relation, 1).actualTargets.join("/"), "关系型", "第二个条目的可接受答案");
	assert(at(relation, 0).key !== at(relation, 1).key, "两个条目 key 应不同");
});

// ---------------------------------------------------------------------------
// 填空题
// ---------------------------------------------------------------------------

test("填空题：从 ==…== 提取答案与空位锚点", () => {
	const question = byTitle(file, "补全 TCP 首部字段");
	assertEqual(question.ok, true, `应解析成功（warnings=${warnCodes(question)}）`);
	assertEqual(question.type, "blank", "题型");
	assertEqual(question.blanks.length, 2, "空位数量");
	assertEqual(at(question.blanks, 0).anchor, "b1", "第一个空位锚点");
	assertEqual(at(question.blanks, 0).expected, "20", "第一个空位答案");
	assertEqual(at(question.blanks, 1).anchor, "b2", "第二个空位锚点");
	assertEqual(at(question.blanks, 1).expected, "序号", "第二个空位答案");
});

test("填空题：blanks 匹配规则被解析", () => {
	const question = byTitle(file, "补全 TCP 首部字段");
	assertEqual(question.blankRules["b1"]?.accept?.join(","), "20,20字节,二十", "b1 的 accept");
	assertEqual(question.blankRules["b2"]?.ignoreCase, true, "b2 忽略大小写");
});

test("填空题：answer 字段被忽略并提示", () => {
	const question = first(
		["## 题", "", "答案是 ==甲== ^b1 和 ==乙== ^b2。", "", "```quiz", "type: blank", "answer: 甲", "```"].join("\n")
	);
	assertEqual(question.answer, null, "answer 应为 null");
	assert(hasWarning(question, "field-invalid"), `应提示 answer 被忽略（warnings=${warnCodes(question)}）`);
});

// ---------------------------------------------------------------------------
// 问答题
// ---------------------------------------------------------------------------

test("问答题：正文即题面，折叠参考答案保留在 body 中", () => {
	const question = byTitle(file, "简述 TCP 与 UDP 的主要区别。");
	assertEqual(question.ok, true, `应解析成功（warnings=${warnCodes(question)}）`);
	assertEqual(question.type, "essay", "题型");
	assertEqual(question.answer, null, "问答题不应有 answer");
	assert(question.body.includes("[!question]- 参考答案"), "参考答案应保留在题面中");
});

test("问答题：没有列表或表格的正文也是合法题面", () => {
	const question = byTitle(file, "三元运算符的语法是什么？");
	assertEqual(question.ok, true, `应解析成功（warnings=${warnCodes(question)}）`);
	assertEqual(question.type, "essay", "题型");
});

// ---------------------------------------------------------------------------
// 降级路径（README §2.6）
// ---------------------------------------------------------------------------

const choice = ["- 选项甲 ^a", "- 选项乙 ^b"];

test("降级：缺少 type 字段", () => {
	const question = first(["## 题", "", ...choice, "", "```quiz", "answer: a", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assertEqual(question.type, null, "题型应为 null");
	assert(hasWarning(question, "type-missing"), `应给出 type-missing（warnings=${warnCodes(question)}）`);
});

test("降级：type 取值非法，提示列出合法取值", () => {
	const question = first(["## 题", "", ...choice, "", "```quiz", "type: multiple", "answer: a", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assertEqual(question.type, null, "题型应为 null");
	const warning = question.warnings.find((item) => item.code === "type-invalid");
	assert(warning !== undefined, `应给出 type-invalid（warnings=${warnCodes(question)}）`);
	assert(warning!.message.includes("single / multi / match / blank / essay"), "提示应列出合法取值");
});

test("降级：type: multi 但题面无列表", () => {
	const question = first(["## 题", "", "这里只有一段正文。", "", "```quiz", "type: multi", "answer: [a]", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assertEqual(question.type, "multi", "题型仍应解析出来");
	assert(hasWarning(question, "structure-mismatch"), `应给出 structure-mismatch（warnings=${warnCodes(question)}）`);
});

test("降级：type: match 但题面无表格", () => {
	const question = first(["## 题", "", "这里只有一段正文。", "", "```quiz", "type: match", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assert(hasWarning(question, "structure-mismatch"), `应给出 structure-mismatch（warnings=${warnCodes(question)}）`);
});

test("降级：配对表格只有一列", () => {
	const question = first(["## 题", "", "| 协议 |", "| --- |", "| HTTP |", "", "```quiz", "type: match", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	const warning = question.warnings.find((item) => item.code === "structure-mismatch");
	assert(warning !== undefined, `应给出 structure-mismatch（warnings=${warnCodes(question)}）`);
	assert(warning!.message.includes("至少需要 2 列"), "提示应说明列数要求");
});

test("降级：type: blank 但题面无空位", () => {
	const question = first(["## 题", "", "这里没有高亮空位。", "", "```quiz", "type: blank", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assert(hasWarning(question, "structure-mismatch"), `应给出 structure-mismatch（warnings=${warnCodes(question)}）`);
});

test("降级：选项缺少锚点", () => {
	const question = first(
		["## 题", "", "- 选项甲 ^a", "- 选项乙", "- 选项丙 ^c", "", "```quiz", "type: single", "answer: a", "```"].join("\n")
	);
	assertEqual(question.ok, false, "应降级");
	assertEqual(question.options.length, 3, "三个选项都应被识别");
	assertEqual(question.answer, null, "降级题不应暴露答案");
	assertEqual(question.answerAnchors.length, 0, "降级题不应暴露可用锚点");
	assert(hasWarning(question, "option-unanchored"), `应给出 option-unanchored（warnings=${warnCodes(question)}）`);
});

test("降级：重复锚点", () => {
	const question = first(
		["## 题", "", "- 选项甲 ^a", "- 选项乙 ^a", "", "```quiz", "type: single", "answer: a", "```"].join("\n")
	);
	assertEqual(question.ok, false, "应降级");
	assert(hasWarning(question, "anchor-duplicate"), `应给出 anchor-duplicate（warnings=${warnCodes(question)}）`);
});

test("降级：answer 指向不存在的锚点", () => {
	const question = first(["## 题", "", ...choice, "", "```quiz", "type: single", "answer: z", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	const warning = question.warnings.find((item) => item.code === "field-invalid");
	assert(warning !== undefined, `应给出 field-invalid（warnings=${warnCodes(question)}）`);
	assert(warning!.message.includes("answer: z"), "提示应指出具体答案值");
});

test("降级：多选题 answer 不是数组", () => {
	const question = first(["## 题", "", ...choice, "", "```quiz", "type: multi", "answer: a", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assertEqual(question.answer, null, "答案应为 null");
	assert(hasWarning(question, "field-invalid"), `应给出 field-invalid（warnings=${warnCodes(question)}）`);
});

test("降级：数据块为空", () => {
	const question = first(["## 题", "", "```quiz", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assert(hasWarning(question, "block-not-mapping"), `应给出 block-not-mapping（warnings=${warnCodes(question)}）`);
});

test("降级：数据块不是键值映射", () => {
	const question = first(["## 题", "", "```quiz", "- 甲", "- 乙", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assert(hasWarning(question, "block-not-mapping"), `应给出 block-not-mapping（warnings=${warnCodes(question)}）`);
});

test("降级：数据块 YAML 语法错误", () => {
	const question = first(["## 题", "", ...choice, "", "```quiz", "type: single", "answer: [a", "```"].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assertEqual(question.type, null, "YAML 解析失败后题型应为 null");
	assert(hasWarning(question, "yaml-error"), `应给出 yaml-error（warnings=${warnCodes(question)}）`);
});

test("降级：缺少数据块", () => {
	const question = first(["## 题", "", ...choice].join("\n"));
	assertEqual(question.ok, false, "应降级");
	assertEqual(question.blockLine, null, "不应有数据块行号");
	assert(hasWarning(question, "missing-block"), `应给出 missing-block（warnings=${warnCodes(question)}）`);
});

test("降级是局部的：坏题不影响同文件其它题", () => {
	const result = parse(
		[
			"## 好题一",
			"",
			...choice,
			"",
			"```quiz",
			"type: single",
			"answer: a",
			"```",
			"",
			"## 坏题",
			"",
			...choice,
			"",
			"```quiz",
			"type: multiple",
			"```",
			"",
			"## 好题二",
			"",
			"```quiz",
			"type: essay",
			"```",
		].join("\n")
	);
	assertEqual(result.questions.length, 3, "三道题都应被解析");
	assertEqual(
		result.questions.map((question) => question.ok).join(","),
		"true,false,true",
		"只有中间那道题应降级"
	);
});

test("降级题绝不产生猜测出来的答案", () => {
	for (const title of ["缺少 type 字段的题", "非法 type 取值的题", "声明为多选题但题面没有列表"]) {
		const question = byTitle(file, title);
		assertEqual(question.ok, false, `「${title}」应降级`);
		assertEqual(question.answer, null, `「${title}」不应暴露可判分答案`);
		assertEqual(question.answerAnchors.length, 0, `「${title}」不应暴露可用锚点`);
	}
});

test("fixture 中恰好 7 道可用题", () => {
	const good = file.questions.filter((question) => question.ok);
	assertEqual(good.length, 7, `可用题数量（实际：${good.map((q) => q.title).join(" | ")}）`);
	assertEqual(file.questions.length - good.length, 8, "降级题数量");
});

// ---------------------------------------------------------------------------
// 结构与边界
// ---------------------------------------------------------------------------

test("题目范围：比题面更深一级的标题归入本题，不单独成题", () => {
	const source = [
		"## 题干",
		"",
		"### 背景",
		"",
		"正文",
		"",
		"```quiz",
		"type: essay",
		"```",
		"",
		"## 下一题",
		"",
		"```quiz",
		"type: essay",
		"```",
	].join("\n");
	// 默认题面层级为 H2：H3 是更深的子标题，归属当前题。
	const result = parse(source);
	assertEqual(result.questions.length, 2, `题目数量（实际：${result.questions.map((q) => q.title).join(" | ")}）`);
	assert(at(result.questions, 0).body.includes("### 背景"), "子标题应留在本题题面内");
});

test("题目范围：更浅的标题存在时，中间层级的标题作为子标题归入本题", () => {
	const source = [
		"## 题干",
		"",
		"### 背景",
		"",
		"正文",
		"",
		"```quiz",
		"type: essay",
		"```",
		"",
		"## 下一题",
		"",
		"```quiz",
		"type: essay",
		"```",
	].join("\n");
	// 文件里存在 H2 时，H3 视为 H2 题面的子标题（即使把 H3 也列入题面层级）。
	const result = parse(source, { headingLevels: [2, 3] });
	assertEqual(
		result.questions.map((q) => q.title).join(","),
		"题干,下一题",
		`题目（实际：${result.questions.map((q) => q.title).join(" | ")}）`
	);
	assert(at(result.questions, 0).body.includes("### 背景"), "子标题应留在本题题面内");
});

test("题目范围：文件只用 H3 时，H3 是题面标题", () => {
	const source = [
		"### 题一",
		"",
		"```quiz",
		"type: essay",
		"```",
		"",
		"### 题二",
		"",
		"```quiz",
		"type: essay",
		"```",
	].join("\n");
	const result = parse(source, { headingLevels: [3, 3] });
	assertEqual(result.questions.length, 2, "两道 H3 题都应被识别");
	assertEqual(at(result.questions, 0).level, 3, "题面层级应为 3");
});

test("数据块位置被记录，便于写回时定位", () => {
	const question = byTitle(file, "TCP 建立连接需要几次握手？");
	assert(question.blockLine !== null, "应记录数据块行号");
	assert(question.line < question.blockLine!, "数据块应在标题之后");
	assert(question.blockSource!.includes("type: single"), "应保留数据块原始源码");
});

test("题面正文不包含数据块内容", () => {
	const question = byTitle(file, "TCP 建立连接需要几次握手？");
	assert(!question.body.includes("type: single"), "body 不应包含数据块字段");
	assert(!question.body.includes("stats:"), "body 不应包含记录数据");
	assert(question.body.includes("- 一次 ^a"), "body 应包含选项");
});

test("未闭合的数据块给出提示且仍能解析内容", () => {
	const question = first(["## 题", "", "```quiz", "type: essay"].join("\n"));
	assertEqual(question.type, "essay", `题型仍应解析出来（warnings=${warnCodes(question)}）`);
	assert(hasWarning(question, "missing-block"), `应提示未闭合（warnings=${warnCodes(question)}）`);
});

test("同一个题面下的多个数据块只使用第一个", () => {
	const question = first(
		["## 题", "", "```quiz", "type: essay", "```", "", "```quiz", "type: single", "```"].join("\n")
	);
	assertEqual(question.type, "essay", "应使用第一个数据块");
	assertEqual(question.blockSource, "type: essay", "只取第一个数据块的源码");
});

test("未知字段给出提示但不影响可用性", () => {
	const question = first(["## 题", "", "```quiz", "type: essay", "foo: bar", "```"].join("\n"));
	assertEqual(question.ok, true, `未知字段不应导致降级（warnings=${warnCodes(question)}）`);
	assert(hasWarning(question, "unknown-field"), `应给出 unknown-field 提示（warnings=${warnCodes(question)}）`);
});

test("shuffle 取值非法时提示并按 false 处理", () => {
	const question = first(["## 题", "", "```quiz", "type: essay", "shuffle: yes", "```"].join("\n"));
	assertEqual(question.shuffle, false, "shuffle 应为 false");
	const warning = question.warnings.find((item) => item.code === "field-invalid");
	assert(warning !== undefined, "应给出 field-invalid");
	assert(warning!.message.includes("shuffle"), "提示应针对 shuffle");
});

test("score 取值非法时提示并按 1 处理", () => {
	const question = first(["## 题", "", "```quiz", "type: essay", "score: -1", "```"].join("\n"));
	assertEqual(question.score, 1, "score 应为 1");
	assert(hasWarning(question, "field-invalid"), `应给出 field-invalid（warnings=${warnCodes(question)}）`);
});

test("数据块语言可配置", () => {
	const source = ["## 题", "", "```easyquiz", "type: essay", "```"].join("\n");
	assertEqual(first(source).ok, false, "默认语言下应降级");
	assertEqual(first(source, { blockLanguage: "easyquiz" }).ok, true, "自定义语言下应解析成功");
});

test("题面标题层级可配置", () => {
	const source = ["# 题一", "", "```quiz", "type: essay", "```"].join("\n");
	assertEqual(parse(source).questions.length, 0, "默认层级不含 h1");
	assertEqual(parse(source, { headingLevels: [1, 3] }).questions.length, 1, "配置后 h1 应成为题面");
});

test("游离的数据块给出文件级提示", () => {
	const result = parse(["```quiz", "type: essay", "```"].join("\n"));
	assert(result.warnings.some((warning) => warning.code === "file"), "应提示数据块不属于任何题面");
});

test("代码块内的 # 不被当作题面标题", () => {
	const result = parse(
		["## 题", "", "```text", "### 这不是标题", "```", "", "```quiz", "type: essay", "```"].join("\n")
	);
	assertEqual(result.questions.length, 1, "代码块内的 ### 不应产生题目");
});

test("frontmatter 未闭合时给出提示但不崩溃", () => {
	const result = parse(["---", "quiz: true", "", "## 题", "", "```quiz", "type: essay", "```"].join("\n"));
	assert(result.warnings.some((warning) => warning.code === "file"), "应提示 frontmatter 未闭合");
});
