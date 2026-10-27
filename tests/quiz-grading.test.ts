/**
 * 判分与写回测试。
 *
 * 写回会改动用户笔记，因此这里重点验证：
 *   - 只改 stats / history / rev，其余内容逐字不动；
 *   - 补丁结果仍是合法 YAML，否则拒绝写入；
 *   - 数据块定位不使用正则猜围栏，正文里的其它代码块不受影响。
 */

import * as yaml from "js-yaml";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { gradeAnswer, matchBlank } from "../src/grade";
import { patchBlockSource, planAcceptStem, planClear, planWriteBack, replaceBlockInFile, WriteBackDeps } from "../src/writeback";
import { contentHash } from "../src/hash";
import { HistoryEntry, QuizQuestion, QuizStats } from "../src/types";
import { assert, assertEqual, at, must, test } from "./harness";

const options: ParseOptions = {
	deps: { parseYaml: (source) => yaml.load(source), hash: contentHash },
};

/** 写回使用与解析相同的依赖形状，避免两处各写一套而产生错配。 */
const writeBackOptions: WriteBackDeps = { deps: options.deps };

function parse(source: string) {
	return parseQuizFile(source, "题库/测试.md", options);
}

function questionOf(source: string): QuizQuestion {
	const result = parse(source);
	assert(result.questions.length > 0, "未解析出题目");
	return must(result.questions[0], '应有题目');
}

const emptyStats: QuizStats = { attempts: 0, correct: 0, lastResult: null, lastAt: null };

function historyEntry(at: string, result: "correct" | "wrong"): HistoryEntry {
	return { at, result };
}

// ---------------------------------------------------------------------------
// 判分：单选 / 多选
// ---------------------------------------------------------------------------

const choiceSource = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 三次握手",
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

test("单选：选对判对，选错判错", () => {
	const question = questionOf(choiceSource);
	assertEqual(gradeAnswer(question, { kind: "choice", anchors: ["c"] }).correct, true, "选 c 应判对");
	const wrong = gradeAnswer(question, { kind: "choice", anchors: ["a"] });
	assertEqual(wrong.correct, false, "选 a 应判错");
	assert(at(wrong.details, 0).note?.includes("c"), `提示应指出正确答案（实际：${at(wrong.details, 0).note}）`);
});

const multiSource = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 传输层协议",
	"",
	"- TCP ^a",
	"- UDP ^b",
	"- IP ^c",
	"",
	"```quiz",
	"type: multi",
	"answer: [a, b]",
	"```",
].join("\n");

test("多选：全对才判对，漏选与多选均判错并说明", () => {
	const question = questionOf(multiSource);
	assertEqual(gradeAnswer(question, { kind: "choice", anchors: ["a", "b"] }).correct, true, "全对应判对");
	const missing = gradeAnswer(question, { kind: "choice", anchors: ["a"] });
	assertEqual(missing.correct, false, "漏选应判错");
	assert(at(missing.details, 0).note?.includes("漏选"), `应提示漏选（实际：${at(missing.details, 0).note}）`);
	const extra = gradeAnswer(question, { kind: "choice", anchors: ["a", "b", "c"] });
	assertEqual(extra.correct, false, "多选应判错");
	assert(at(extra.details, 0).note?.includes("多选"), `应提示多选（实际：${at(extra.details, 0).note}）`);
});

test("多选：判分与选项顺序无关", () => {
	const question = questionOf(multiSource);
	assertEqual(gradeAnswer(question, { kind: "choice", anchors: ["b", "a"] }).correct, true, "顺序不同也应判对");
});

// ---------------------------------------------------------------------------
// 判分：填空
// ---------------------------------------------------------------------------

const blankSource = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 首部字段",
	"",
	"最小长度是 ==20== ^b1 字节，==序号== ^b2 字段标识首字节。",
	"",
	"```quiz",
	"type: blank",
	"blanks:",
	'  b1: { accept: ["20", "二十"] }',
	"  b2: { ignoreCase: true }",
	"```",
].join("\n");

test("填空：accept 列表命中即判对", () => {
	const question = questionOf(blankSource);
	assertEqual(gradeAnswer(question, { kind: "blank", values: ["20", "序号"] }).correct, true, "精确匹配应判对");
	assertEqual(gradeAnswer(question, { kind: "blank", values: ["二十", "序号"] }).correct, true, "accept 命中应判对");
});

test("填空：逐空判分，指出哪一空错了", () => {
	const question = questionOf(blankSource);
	const result = gradeAnswer(question, { kind: "blank", values: ["30", "序号"] });
	assertEqual(result.correct, false, "第一空错误应判错");
	assertEqual(at(result.details, 0).correct, false, "第一空应标记错误");
	assertEqual(at(result.details, 1).correct, true, "第二空应标记正确");
	assert(at(result.details, 0).note?.includes("20"), "应给出正确答案");
});

test("填空：首尾空白被忽略", () => {
	const question = questionOf(blankSource);
	assertEqual(gradeAnswer(question, { kind: "blank", values: [" 20 ", "序号"] }).correct, true, "首尾空白应被忽略");
});

test("填空：默认精确匹配，大小写不同判错", () => {
	assertEqual(matchBlank("ABC", "abc", {}), false, "默认应区分大小写");
	assertEqual(matchBlank("abc", "abc", {}), true, "相同应判对");
	assertEqual(matchBlank(" abc ", "abc", {}), true, "首尾空白应忽略");
	assertEqual(matchBlank("abc", "abc", { ignoreCase: true }), true, "忽略大小写时应判对");
});

test("填空：regex 规则生效，非法正则不崩溃", () => {
	assertEqual(matchBlank("20字节", "^\\d+", { regex: true }), true, "正则应匹配");
	assertEqual(matchBlank("abc", "^\\d+", { regex: true }), false, "正则不匹配应判错");
	assertEqual(matchBlank("abc", "[", { regex: true }), false, "非法正则应判错而不是抛错");
});

// ---------------------------------------------------------------------------
// 判分：配对
// ---------------------------------------------------------------------------

const matchSource = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 配对",
	"",
	"| 协议 | 端口 |",
	"| --- | --- |",
	"| HTTP | 80 |",
	"| SSH | 22 |",
	"",
	"```quiz",
	"type: match",
	"```",
].join("\n");

test("配对：连对全部连线才判对", () => {
	const question = questionOf(matchSource);
	const pairs = question.boardPairs.map((pair) => ({ left: pair.left, right: pair.right }));
	assertEqual(pairs.length, 2, "两行两列表格应有两条连线");
	assertEqual(gradeAnswer(question, { kind: "match", pairs }).correct, true, "全连对应判对");
});

test("配对：连线顺序不影响判分", () => {
	const question = questionOf(matchSource);
	const pairs = question.boardPairs.map((pair) => ({ left: pair.left, right: pair.right })).reverse();
	assertEqual(gradeAnswer(question, { kind: "match", pairs }).correct, true, "顺序颠倒也应判对");
});

test("配对：左右方向互换仍然判对", () => {
	const question = questionOf(matchSource);
	// 把每条线写成「右-左」，判分应当等效。
	const pairs = question.boardPairs.map((pair) => ({ left: pair.right, right: pair.left }));
	assertEqual(gradeAnswer(question, { kind: "match", pairs }).correct, true, "方向无关");
});

test("配对：未作答时给出缺少的连线", () => {
	const question = questionOf(matchSource);
	const result = gradeAnswer(question, { kind: "match", pairs: [] });
	assertEqual(result.correct, false, "未作答应判错");
	assert(
		result.details.some((detail) => detail.note?.includes("缺少连线")),
		`应说明缺少连线（实际：${JSON.stringify(result.details.map((d) => d.note))}）`
	);
});

test("配对：连错一条即判错，并给出缺少与多余", () => {
	const question = questionOf(matchSource);
	const first = at(question.boardPairs, 0);
	const second = at(question.boardPairs, 1);
	// 把第一条连成错的（跨到第二条的右端），于是既缺一条又错一条。
	const pairs = [{ left: first.left, right: second.right }];
	const result = gradeAnswer(question, { kind: "match", pairs });
	assertEqual(result.correct, false, "应判错");
	assert(
		result.details.some((detail) => detail.note?.includes("缺少连线")),
		"应指出缺少的连线"
	);
	assert(
		result.details.some((detail) => detail.note?.includes("多余")),
		"应指出多余的连线"
	);
});

test("配对：三列表格要 A-B 与 B-C 都连对", () => {
	const question = questionOf(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 配对",
			"",
			"| 协议 | 端口 | 层级 |",
			"| --- | --- | --- |",
			"| HTTP | 80 | 应用层 |",
			"| IP | 0 | 网络层 |",
			"",
			"```quiz",
			"type: match",
			"```",
		].join("\n")
	);
	assertEqual(question.board.length, 3, "三列");
	assertEqual(question.boardPairs.length, 4, "A-B 两条 + B-C 两条");

	const all = question.boardPairs.map((pair) => ({ left: pair.left, right: pair.right }));
	assertEqual(gradeAnswer(question, { kind: "match", pairs: all }).correct, true, "全部连对应判对");

	// 只连 A-B，缺 B-C。
	const onlyFirstPair = all.slice(0, 2);
	assertEqual(gradeAnswer(question, { kind: "match", pairs: onlyFirstPair }).correct, false, "缺少 B-C 应判错");
});

test("配对：跨列连线（A-C）算多余，判错", () => {
	const question = questionOf(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 配对",
			"",
			"| 协议 | 端口 | 层级 |",
			"| --- | --- | --- |",
			"| HTTP | 80 | 应用层 |",
			"",
			"```quiz",
			"type: match",
			"```",
		].join("\n")
	);
	const columnA = at(question.board, 0).items.map((item) => item.key);
	const columnC = at(question.board, 2).items.map((item) => item.key);
	const crossed = [{ left: at(columnA, 0), right: at(columnC, 0) }];
	const result = gradeAnswer(question, { kind: "match", pairs: crossed });
	assertEqual(result.correct, false, "跨列连线不应算对");
	assert(
		result.details.some((detail) => detail.note?.includes("多余")),
		"应指出这是多余的连线"
	);
});

test("配对：一格就是一个条目，两行的连线都要连上", () => {
	const question = questionOf(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 配对",
			"",
			"| 数据库 | 类型 |",
			"| --- | --- |",
			"| MySQL / PostgreSQL | 关系型 |",
			"| Redis | 键值型 |",
			"",
			"```quiz",
			"type: match",
			"```",
		].join("\n")
	);
	assertEqual(
		at(question.board, 0).items.map((item) => item.text).join(","),
		"MySQL / PostgreSQL,Redis",
		"单元格内容不拆分"
	);
	assertEqual(question.boardPairs.length, 2, "两行两条连线");
	const all = question.boardPairs.map((pair) => ({ left: pair.left, right: pair.right }));
	assertEqual(gradeAnswer(question, { kind: "match", pairs: all }).correct, true, "两条都连上应判对");
	assertEqual(gradeAnswer(question, { kind: "match", pairs: all.slice(0, 1) }).correct, false, "只连一条应判错");
});

// ---------------------------------------------------------------------------
// 判分：问答与不可作答
// ---------------------------------------------------------------------------

test("问答：按自评结果判分", () => {
	const question = questionOf(["---", "quiz: true", "---", "", "## 问答", "", "```quiz", "type: essay", "```"].join("\n"));
	assertEqual(gradeAnswer(question, { kind: "essay", result: "correct" }).correct, true, "已掌握应判对");
	assertEqual(gradeAnswer(question, { kind: "essay", result: "wrong" }).correct, false, "未掌握应判错");
});

test("不可作答的题拒绝判分", () => {
	const question = questionOf(
		["---", "quiz: true", "---", "", "## 坏题", "", "- 甲 ^a", "", "```quiz", "type: multiple", "```"].join("\n")
	);
	assertEqual(question.ok, false, "应降级");
	let threw = false;
	try {
		gradeAnswer(question, { kind: "choice", anchors: ["a"] });
	} catch {
		threw = true;
	}
	assert(threw, "对降级题判分应抛错而不是给出猜测结果");
});

// ---------------------------------------------------------------------------
// 数据块补丁
// ---------------------------------------------------------------------------

test("补丁：已有字段被替换，其余行逐字保留", () => {
	const source = ["type: single", "# 注释保留", "answer: c", "explanation: 说明"].join("\n");
	const patched = patchBlockSource(source, { answer: "answer: d" });
	assertEqual(patched, ["type: single", "# 注释保留", "answer: d", "explanation: 说明"].join("\n"), "应只替换 answer");
});

test("补丁：字段不存在时追加到末尾", () => {
	const source = ["type: single", "answer: c"].join("\n");
	const patched = patchBlockSource(source, { stats: "stats: { attempts: 1, correct: 1 }" });
	assertEqual(
		patched,
		["type: single", "answer: c", "", "stats: { attempts: 1, correct: 1 }"].join("\n"),
		"应追加新字段"
	);
});

test("补丁：块状 history 被整体替换，不留下孤儿子行", () => {
	const source = ["type: single", "history:", "  - { at: 旧, result: correct }", "answer: c"].join("\n");
	const patched = patchBlockSource(source, { history: "history: []" });
	assertEqual(patched, ["type: single", "history: []", "answer: c"].join("\n"), "旧的子行应被吞掉");
});

// ---------------------------------------------------------------------------
// 写回方案（含校验）
// ---------------------------------------------------------------------------

const fullSource = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 三次握手",
	"",
	"- 一次 ^a",
	"- 三次 ^c",
	"",
	"```quiz",
	"type: single",
	"answer: c",
	"```",
	"",
	"## 下一题",
	"",
	"```quiz",
	"type: essay",
	"```",
].join("\n");

test("写回方案：补丁结果仍是合法数据块", () => {
	const question = questionOf(fullSource);
	const stats: QuizStats = { attempts: 1, correct: 1, lastResult: "correct", lastAt: "2025-01-01T00:00:00.000Z" };
	const patch = planWriteBack(
		question.blockSource!,
		stats,
		[historyEntry(stats.lastAt!, "correct")],
		"abcd1234",
		writeBackOptions
	);
	assertEqual(patch.applied, true, `应可写入（原因：${patch.reason ?? "无"}）`);
	assert(patch.content.includes("stats:"), "应写入 stats");
	assert(patch.content.includes("rev: abcd1234"), "应写入 rev");
	assert(patch.content.includes("history:"), "应写入 history");

	// 校验：补丁结果必须仍能被解析成同一道题（连同题面选项一起还原）。
	const reparsed = parseQuizFile(
		[
			"---",
			"quiz: true",
			"---",
			"",
			"## 三次握手",
			"",
			"- 一次 ^a",
			"- 三次 ^c",
			"",
			"```quiz",
			patch.content,
			"```",
		].join("\n"),
		"x.md",
		options
	).questions[0];
	assertEqual(must(reparsed, '应有题目').ok, true, `还原后应仍可作答（warnings=${must(reparsed, '应有题目').warnings.map((w) => w.code).join(",")}）`);
	assertEqual(must(reparsed, '应有题目').stats.attempts, 1, "补丁后应能读回 attempts");
	assertEqual(must(reparsed, '应有题目').stats.correct, 1, "补丁后应能读回 correct");
	assertEqual(must(reparsed, '应有题目').history.length, 1, "补丁后应能读回 history");
	assertEqual(must(reparsed, '应有题目').type, "single", "补丁不应破坏原有字段");
	assertEqual(must(reparsed, '应有题目').answer, "c", "补丁不应破坏答案");
});

test("写回方案：无法解析的数据块拒绝写入", () => {
	const patch = planWriteBack("type: single\nanswer: [a", emptyStats, [], "rev1", writeBackOptions);
	assertEqual(patch.applied, false, "应拒绝写入");
	assert(patch.reason !== undefined, "应给出原因");
	assertEqual(patch.content, "type: single\nanswer: [a", "拒绝时应原样返回，不做任何改动");
});

test("写回方案：history 超出上限时丢弃最旧的", () => {
	const question = questionOf(fullSource);
	const history = [1, 2, 3, 4, 5].map((index) => historyEntry(`2025-01-0${index}T00:00:00.000Z`, "correct"));
	const patch = planWriteBack(question.blockSource!, emptyStats, history, "rev1", writeBackOptions, 2);
	assertEqual(patch.applied, true, `应可写入（原因：${patch.reason ?? "无"}）`);
	assert(patch.content.includes("2025-01-04"), "应保留最新一条");
	assert(!patch.content.includes("2025-01-03"), "应丢弃超出上限的旧记录");
});

test("写回方案：上限为 0 时只留汇总", () => {
	const question = questionOf(fullSource);
	const patch = planWriteBack(
		question.blockSource!,
		emptyStats,
		[historyEntry("2025-01-01T00:00:00.000Z", "correct")],
		"rev1",
		writeBackOptions,
		0
	);
	assertEqual(patch.applied, true, `应可写入（原因：${patch.reason ?? "无"}）`);
	assert(!patch.content.includes("history"), "不应写入 history");
	assert(patch.content.includes("stats:"), "仍应写入 stats");
});

// ---------------------------------------------------------------------------
// 在整份文件中替换数据块
// ---------------------------------------------------------------------------

test("替换：只改目标数据块，其它题目与正文不动", () => {
	const question = questionOf(fullSource);
	const next = replaceBlockInFile(
		fullSource,
		question.blockLine!,
		"type: single\nanswer: c\nstats: { attempts: 1, correct: 1 }"
	);
	assert(next !== null, "应能定位并替换");
	assert(next!.includes("stats: { attempts: 1, correct: 1 }"), "应写入新内容");
	assert(next!.includes("## 下一题"), "后续题目应保留");
	assert(next!.includes("- 三次 ^c"), "题面应保留");

	const reparsed = parseQuizFile(next!, "题库/测试.md", options);
	assertEqual(reparsed.questions.length, 2, "题目数量不变");
	assertEqual(at(must(reparsed, '应有题目').questions, 0).stats.attempts, 1, "第一题记录已更新");
	assertEqual(at(must(reparsed, '应有题目').questions, 1).type, "essay", "第二题未被破坏");
});

test("替换：正文里的其它代码块不受影响", () => {
	const source = [
		"---",
		"quiz: true",
		"---",
		"",
		"## 含代码块的题",
		"",
		"```js",
		"const a = 1;",
		"```",
		"",
		"```quiz",
		"type: essay",
		"```",
	].join("\n");
	const question = questionOf(source);
	const next = replaceBlockInFile(source, question.blockLine!, "type: essay\nstats: { attempts: 1, correct: 1 }");
	assert(next !== null, "应能定位");
	assert(next!.includes("const a = 1;"), "正文代码块应原样保留");
	assert(next!.includes("```js"), "代码块围栏应保留");
});

test("替换：行号指向的不是数据块时拒绝操作", () => {
	const next = replaceBlockInFile(fullSource, 6, "type: single");
	assertEqual(next, null, "指向正文行时应拒绝，避免破坏笔记");
});

test("替换：内容相同时逐字不变", () => {
	const source = ["---", "quiz: true", "---", "", "## 题", "", "```quiz", "type: essay", "```"].join("\n");
	const question = questionOf(source);
	const next = replaceBlockInFile(source, question.blockLine!, "type: essay");
	assertEqual(next, source, "内容相同时应逐字相同");
});

test("清除记录：只删 stats 与 history，保留题目本身", () => {
	const block = [
		"id: keep",
		"type: single",
		"answer: a",
		"stats:",
		"  attempts: 3",
		"  correct: 1",
		"history:",
		"  - at: 2025-01-01T00:00:00.000Z",
		"    result: wrong",
		"rev: abcd1234",
	].join("\n");
	const patch = planClear(block, writeBackOptions);
	assertEqual(patch.applied, true, `应可清除（原因：${patch.reason ?? "无"}）`);
	assert(!patch.content.includes("stats:"), "stats 应被删除");
	assert(!patch.content.includes("history:"), "history 应被删除");
	assert(patch.content.includes("type: single"), "题型应保留");
	assert(patch.content.includes("answer: a"), "答案应保留");
	assert(patch.content.includes("rev: abcd1234"), "rev 记录的是题面版本，不应删除");

	// 清干净后必须仍能解析成同一道题，否则宁可不清。
	const reparsed = parse([
		"---",
		"quiz: true",
		"---",
		"",
		"## 题",
		"",
		"- 甲 ^a",
		"- 乙 ^b",
		"",
		"```quiz",
		patch.content,
		"```",
	].join("\n"));
	const question = must(reparsed.questions[0], "应解析出题目");
	assertEqual(question.ok, true, "清除后仍应可作答");
	assertEqual(question.stats.attempts, 0, "清除后应回到未作答");
	assertEqual(question.history.length, 0, "清除后不应留下历史");
});

test("清除记录：没有记录的题目不改动", () => {
	const block = ["type: essay", "answer: 略"].join("\n");
	const patch = planClear(block, writeBackOptions);
	assertEqual(patch.applied, true, "合法 YAML 应可直接清除（内容相同）");
	assertEqual(patch.content, block, "没有记录时逐字不变");
});

test("关闭题面提示：只把 rev 更新成当前题面的版本", () => {
	const block = [
		"id: keep",
		"type: essay",
		"stats:",
		"  attempts: 2",
		"  correct: 1",
		"rev: oldrev",
	].join("\n");
	const patch = planAcceptStem(block, "newrev", writeBackOptions);
	assertEqual(patch.applied, true, `应可写回（原因：${patch.reason ?? "无"}）`);
	assert(patch.content.includes("rev: \"newrev\""), "rev 应更新为当前题面版本");
	assert(patch.content.includes("attempts: 2"), "作答记录不应受影响");
	assert(!patch.content.includes("oldrev"), "旧的 rev 不应残留");

	const reparsed = parse([
		"---",
		"quiz: true",
		"---",
		"",
		"## 题",
		"",
		"```quiz",
		patch.content,
		"```",
	].join("\n"));
	const question = must(reparsed.questions[0], "应解析出题目");
	assertEqual(question.rev, "newrev", "写回的 rev 应被解析回来");
	assertEqual(question.stats.attempts, 2, "统计应保留");
});

test("关闭题面提示：非法 YAML 时不改动", () => {
	const block = "type: [unclosed";
	const patch = planAcceptStem(block, "newrev", writeBackOptions);
	assertEqual(patch.applied, false, "坏掉的 YAML 不应写入");
	assertEqual(patch.content, block, "内容应逐字不变");
});
