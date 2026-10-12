/**
 * 刷题会话纯逻辑测试。
 *
 * 覆盖：文件汇总 / 列表合计 / 题目筛选 / 队列生成（顺序 · 随机 · 错题）/ 洗牌与抽样 /
 * 进度计算 / 题目定位。
 *
 * 断言只依赖可观察行为，不依赖实现细节；所有随机的用例都注入可复现的序列，
 * 因此结果不会随 Math.random 的分布而飘。测试用的题目都来自真实 Markdown fixture，
 * 经过 src/parser.ts 解析，避免手工拼 QuizQuestion 而与解析器脱节。
 */

import * as yaml from "js-yaml";
import { contentHash } from "../src/hash";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { ParsedQuizFile, QUIZ_TYPES } from "../src/types";
import {
	buildSession,
	DEFAULT_SESSION_CONFIG,
	FileSummary,
	filterQuestions,
	ParsedMap,
	QueueEntry,
	resolveEntry,
	sampleWith,
	SessionConfig,
	sessionProgress,
	shuffleWith,
	summarizeAll,
	summarizeFile,
	TYPE_ORDER,
} from "../src/session";
import { assert, assertEqual, at, must, test } from "./harness";

// ---------------------------------------------------------------------------
// 测试脚手架
// ---------------------------------------------------------------------------

const options: ParseOptions = { deps: { parseYaml: (source) => yaml.load(source), hash: contentHash } };

/** 用真实解析器解析一段 Markdown。 */
function parse(source: string, path = "题库/测试.md"): ParsedQuizFile {
	return parseQuizFile(source, path, options);
}

/**
 * 汇总用例的主文件：一道带 stats 的单选题、一道填空题、一道忘了写数据块的降级题。
 *
 * `stats` / `history` 由解析器从数据块里读回（见 parser.ts 的 readStats）：
 * `lastAt` 必须是字符串，因此 fixture 里写成带引号的 ISO 时间，否则会被 YAML 解析成 Date 而读不回来。
 */
const summarySource = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 握手需要几次？",
	"",
	"- 一次 ^a",
	"- 两次 ^b",
	"",
	"```quiz",
	"id: q-single",
	"type: single",
	"answer: b",
	'stats: { attempts: 3, correct: 2, lastResult: wrong, lastAt: "2025-01-02T10:00:00Z" }',
	"```",
	"",
	"## 首部最小长度",
	"",
	"TCP 首部的最小长度是 ==20== ^b1 字节。",
	"",
	"```quiz",
	"id: q-blank",
	"type: blank",
	'stats: { attempts: 1, correct: 1, lastResult: correct, lastAt: "2025-01-03T09:00:00Z" }',
	"```",
	"",
	"## 还没有写完的题",
	"",
	"这里忘了写数据块。",
	"",
].join("\n");

/** 另一份文件：一道可作答题，用于验证合计是累加而不是覆盖。 */
const otherSource = [
	"## 另一份里的一题",
	"",
	"- 甲 ^a",
	"- 乙 ^b",
	"",
	"```quiz",
	"id: other-1",
	"type: single",
	"answer: a",
	'stats: { attempts: 5, correct: 5, lastResult: correct, lastAt: "2025-03-01T00:00:00Z" }',
	"```",
].join("\n");

/** 只有一个选项的单选题：结构不符 → 降级，但 `type` 仍然读得出来。 */
const brokenTypedSource = [
	"## 只有一个选项的题",
	"",
	"- 唯一选项 ^a",
	"",
	"```quiz",
	"type: single",
	"answer: a",
	"```",
].join("\n");

const summaryFile = parse(summarySource);
const summary = summarizeFile(summaryFile, "题库/测试.md", 1700000000000);

/** 生成一道单选题的 Markdown；`lastAt` 为 null 时不写 stats 字段。 */
function single(title: string, id: string, lastResult: "correct" | "wrong" | null, lastAt = "2025-02-01T00:00:00Z"): string {
	const lines = [
		`## ${title}`,
		"",
		"- 甲 ^a",
		"- 乙 ^b",
		"",
		"```quiz",
		`id: ${id}`,
		"type: single",
		"answer: a",
	];
	if (lastResult !== null) {
		lines.push(`stats: { attempts: 2, correct: 1, lastResult: ${lastResult}, lastAt: "${lastAt}" }`);
	}
	lines.push("```", "");
	return lines.join("\n");
}

/** 把若干题面拼成一份完整的题库文件。 */
function quizSource(blocks: string[]): string {
	return ["---", "quiz: true", "---", "", ...blocks].join("\n");
}

const pathA = "题库/甲.md";
const pathB = "题库/乙.md";

/** 两道题的文件甲 + 两道题的文件乙。 */
function buildMap(): ParsedMap {
	const map: ParsedMap = new Map<string, ParsedQuizFile>();
	map.set(pathA, parse(quizSource([single("甲一", "a1", "correct"), single("甲二", "a2", "wrong", "2025-02-05T00:00:00Z")]), pathA));
	map.set(pathB, parse(quizSource([single("乙一", "b1", "wrong"), single("乙二", "b2", "correct")]), pathB));
	return map;
}

/** 队列项的稳定标识，便于断言顺序。 */
function ref(entry: QueueEntry): string {
	return `${entry.path}#${entry.id}`;
}

/** 可复现的伪随机序列（LCG），用于「同种子同结果」的断言。 */
function seededRandom(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state * 1664525 + 1013904223) >>> 0;
		return state / 4294967296;
	};
}

/** 恒定返回值，用于手算确定结果（0.5 与 0 都是好算的边界）。 */
function constantRandom(value: number): () => number {
	return () => value;
}

// ---------------------------------------------------------------------------
// 题型顺序
// ---------------------------------------------------------------------------

test("题型顺序与解析器的 QUIZ_TYPES 一致", () => {
	assertEqual(TYPE_ORDER.join(","), QUIZ_TYPES.join(","), "题型顺序不应与解析器分叉");
	assertEqual(TYPE_ORDER.length, QUIZ_TYPES.length, "题型数量");
});

// ---------------------------------------------------------------------------
// summarizeFile
// ---------------------------------------------------------------------------

test("汇总文件：题面数、可作答数与降级数", () => {
	assertEqual(summary.total, 3, "三道题面");
	assertEqual(summary.answerable, 2, "两道可作答");
	assertEqual(summary.broken, 1, "一道降级");
});

test("汇总文件：issues 统计降级题的提示条数", () => {
	// 缺数据块的题会同时给出「缺少数据块」与「缺少 type」两条提示（见 parser.ts）。
	assertEqual(at(summaryFile.questions, 2).ok, false, "第三道题应降级");
	assertEqual(summary.issues, at(summaryFile.questions, 2).warnings.length, "issues 应等于降级题的提示条数");
	assert(summary.issues > 0, "降级题应贡献待修正提示");
});

test("汇总文件：作答次数与答对数只统计可作答题", () => {
	assertEqual(summary.attempts, 4, "3 + 1 次作答");
	assertEqual(summary.correct, 3, "2 + 1 次答对");
});

test("汇总文件：按题型统计可作答题数", () => {
	assertEqual(TYPE_ORDER.map((type) => summary.byType[type]).join(","), "1,0,0,1,0", "single 一道、blank 一道");
	assertEqual(summary.byType.single, 1, "单选题数");
	assertEqual(summary.byType.blank, 1, "填空题数");
	assertEqual(summary.byType.match, 0, "没有配对题");
});

test("汇总文件：lastAt 取最近一次作答时间", () => {
	assertEqual(summary.lastAt, "2025-01-03T09:00:00Z", "应取较晚的那次作答");
});

test("汇总文件：无作答记录时 lastAt 为 null，路径与 mtime 原样带回", () => {
	const parsed = parse(
		["## 未作答的题", "", "- 甲 ^a", "- 乙 ^b", "", "```quiz", "type: single", "answer: a", "```", ""].join("\n")
	);
	const item = summarizeFile(parsed, "根.md", 0);
	assertEqual(item.lastAt, null, "没有记录时 lastAt 应为 null");
	assertEqual(item.attempts, 0, "没有记录时 attempts 为 0");
	assertEqual(item.path, "根.md", "path 原样带回");
	assertEqual(item.folder, "", "vault 根下的文件文件夹为空");
	assertEqual(item.mtime, 0, "mtime 原样带回");
});

test("汇总文件：子目录里的文件带出所属文件夹", () => {
	const nested = summarizeFile(summaryFile, "资料/题库/网络.md", 42);
	assertEqual(nested.folder, "资料/题库", "文件夹应为路径去掉文件名");
	assertEqual(nested.path, "资料/题库/网络.md", "path 不应被改写");
	assertEqual(nested.mtime, 42, "mtime 不应被改写");
});

// ---------------------------------------------------------------------------
// summarizeAll
// ---------------------------------------------------------------------------

test("合计：空列表返回全零而不是 NaN", () => {
	const totals = summarizeAll([]);
	assertEqual(totals.files, 0, "文件数");
	assertEqual(totals.questions, 0, "题面数");
	assertEqual(totals.answerable, 0, "可作答题数");
	assertEqual(totals.broken, 0, "降级题数");
	assertEqual(totals.issues, 0, "待修正提示数");
	assertEqual(totals.attempts, 0, "作答次数");
	assertEqual(totals.correct, 0, "答对数");
});

test("合计：逐项累加各文件的汇总", () => {
	const other = summarizeFile(parse(otherSource, "题库/另一份.md"), "题库/另一份.md", 1);
	const totals = summarizeAll([summary, other]);
	assertEqual(totals.files, 2, "两个文件");
	assertEqual(totals.questions, 4, "3 + 1 道题面");
	assertEqual(totals.answerable, 3, "2 + 1 道可作答");
	assertEqual(totals.broken, 1, "1 + 0 道降级");
	assertEqual(totals.issues, 2, "只有降级题贡献的两条提示");
	assertEqual(totals.attempts, 9, "4 + 5 次作答");
	assertEqual(totals.correct, 8, "3 + 5 次答对");
});

// ---------------------------------------------------------------------------
// filterQuestions
// ---------------------------------------------------------------------------

const allQuestions = summaryFile.questions;

test("筛选：默认丢弃降级题", () => {
	const kept = filterQuestions(allQuestions, { types: [], includeBroken: false, wrongOnly: false });
	assertEqual(kept.length, 2, "三道题里只保留可作答的两道");
	assertEqual(kept.map((question) => question.id).join(","), "q-single,q-blank", "顺序应与题面一致");
});

test("筛选：includeBroken 保留降级题", () => {
	const kept = filterQuestions(allQuestions, { types: [], includeBroken: true, wrongOnly: false });
	assertEqual(kept.length, 3, "应带上降级题");
	assertEqual(at(kept, 2).ok, false, "最后一道是降级题");
	assertEqual(at(kept, 2).id, at(allQuestions, 2).id, "降级题应保持在原位置");
});

test("筛选：按题型过滤", () => {
	const blanks = filterQuestions(allQuestions, { types: ["blank"], includeBroken: false, wrongOnly: false });
	assertEqual(blanks.map((question) => question.id).join(","), "q-blank", "只应留下填空题");
	const singles = filterQuestions(allQuestions, { types: ["single"], includeBroken: false, wrongOnly: false });
	assertEqual(singles.map((question) => question.id).join(","), "q-single", "只应留下单选题");
});

test("筛选：降级题即使显式带上也不会命中非空题型集合", () => {
	const broken = parse(brokenTypedSource).questions;
	assertEqual(at(broken, 0).type, "single", "题型仍能读出");
	assertEqual(at(broken, 0).ok, false, "结构不符应降级");
	assertEqual(
		filterQuestions(broken, { types: ["single"], includeBroken: false, wrongOnly: false }).length,
		0,
		"默认不应保留降级题"
	);
	assertEqual(
		filterQuestions(broken, { types: ["single"], includeBroken: true, wrongOnly: false }).length,
		1,
		"显式带上降级题时应保留"
	);
});

test("筛选：wrongOnly 只保留上次答错的题", () => {
	const kept = filterQuestions(allQuestions, { types: [], includeBroken: false, wrongOnly: true });
	assertEqual(kept.map((question) => question.id).join(","), "q-single", "只有上次答错的那道留下");
});

test("筛选：types 为空表示不限题型", () => {
	const unrestricted = filterQuestions(allQuestions, { types: [], includeBroken: false, wrongOnly: false });
	const onlySingle = filterQuestions(allQuestions, { types: ["single"], includeBroken: false, wrongOnly: false });
	assertEqual(unrestricted.length, 2, "空数组不过滤任何题型");
	assertEqual(onlySingle.length, 1, "显式指定题型时才过滤");
	assert(unrestricted.length > onlySingle.length, "不限题型时应保留更多题");
});

// ---------------------------------------------------------------------------
// buildSession
// ---------------------------------------------------------------------------

test("组卷：order 模式按文件顺序与题面顺序出题", () => {
	const entries = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "order" }, buildMap());
	assertEqual(
		entries.map(ref).join(","),
		"题库/甲.md#a1,题库/甲.md#a2,题库/乙.md#b1,题库/乙.md#b2",
		"顺序应与文件、题面顺序一致"
	);
	assertEqual(at(entries, 0).title, "甲一", "队列项应带上题面标题");
	assertEqual(at(entries, 0).path, pathA, "队列项应带上文件路径");
});

test("组卷：order 模式默认不打乱（shuffle 为 false）", () => {
	assertEqual(DEFAULT_SESSION_CONFIG.shuffle, false, "默认不打乱");
	const entries = buildSession(DEFAULT_SESSION_CONFIG, buildMap(), constantRandom(0));
	assertEqual(entries.map(ref).join(","), "题库/甲.md#a1,题库/甲.md#a2,题库/乙.md#b1,题库/乙.md#b2", "不应被随机打乱");
});

test("组卷：显式打开 shuffle 时 order 模式也会打乱", () => {
	const config: SessionConfig = { ...DEFAULT_SESSION_CONFIG, mode: "order", shuffle: true };
	const entries = buildSession(config, buildMap(), constantRandom(0));
	assertEqual(
		entries.map(ref).join(","),
		"题库/甲.md#a2,题库/乙.md#b1,题库/乙.md#b2,题库/甲.md#a1",
		"常量随机的确定排列"
	);
});

test("组卷：random 模式抽取指定数量且不重复", () => {
	const entries = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "random", randomCount: 2 }, buildMap(), seededRandom(9));
	assertEqual(entries.length, 2, "应抽取 2 道题");
	assertEqual(new Set(entries.map(ref)).size, 2, "不应出现重复题");
	const pool = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "order" }, buildMap()).map(ref);
	assert(entries.every((entry) => pool.includes(ref(entry))), "抽到的题必须来自同一个题库池");
});

test("组卷：random 模式同一种子得到同一结果", () => {
	const config: SessionConfig = { ...DEFAULT_SESSION_CONFIG, mode: "random", randomCount: 3 };
	const first = buildSession(config, buildMap(), seededRandom(2025));
	const second = buildSession(config, buildMap(), seededRandom(2025));
	assertEqual(first.map(ref).join(","), second.map(ref).join(","), "同一种子应得到同一顺序");
});

test("组卷：randomCount <= 0 时返回全部题目", () => {
	const zero = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "random", randomCount: 0 }, buildMap(), seededRandom(2));
	assertEqual(zero.length, 4, "0 表示全部");
	const negative = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "random", randomCount: -3 }, buildMap(), seededRandom(2));
	assertEqual(negative.length, 4, "负数同样表示全部");
	assertEqual(new Set(negative.map(ref)).size, 4, "全部题目不应重复");
});

test("组卷：randomCount 超过题量时返回全部", () => {
	const entries = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "random", randomCount: 99 }, buildMap(), seededRandom(3));
	assertEqual(entries.length, 4, "最多只能给出池子里的全部题目");
});

test("组卷：wrong 模式只保留上次答错的题", () => {
	const entries = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "wrong" }, buildMap());
	assertEqual(entries.map(ref).join(","), "题库/甲.md#a2,题库/乙.md#b1", "只应留下 lastResult 为 wrong 的题");
});

test("组卷：wrongOnly 在任何模式下都只保留答错的题", () => {
	const config: SessionConfig = { ...DEFAULT_SESSION_CONFIG, mode: "random", wrongOnly: true, randomCount: 0 };
	const entries = buildSession(config, buildMap(), seededRandom(4));
	assertEqual(entries.length, 2, "只有两道答错的题");
	assert(entries.every((entry) => entry.id === "a2" || entry.id === "b1"), "只应包含答错的题");
});

test("组卷：默认不带降级题，includeBroken 时才进队列", () => {
	const map: ParsedMap = new Map<string, ParsedQuizFile>();
	map.set("题库/汇总.md", parse(summarySource, "题库/汇总.md"));
	const strict = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "order" }, map);
	assertEqual(strict.map(ref).join(","), "题库/汇总.md#q-single,题库/汇总.md#q-blank", "默认只出可作答题");
	const lenient = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "order", includeBroken: true }, map);
	assertEqual(lenient.length, 3, "includeBroken 时降级题也进队列");
});

test("组卷：不在解析结果里的文件被跳过", () => {
	const map = buildMap();
	const entries = buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "order" }, map);
	assert(entries.every((entry) => map.has(entry.path)), "队列项必须来自已解析的文件");

	// 只放文件甲时，文件乙里的题不应出现在队列里。
	const onlyA: ParsedMap = new Map<string, ParsedQuizFile>();
	onlyA.set(pathA, must(map.get(pathA), "文件甲应在 map 里"));
	assertEqual(
		buildSession({ ...DEFAULT_SESSION_CONFIG, mode: "order" }, onlyA).map(ref).join(","),
		"题库/甲.md#a1,题库/甲.md#a2",
		"只出 map 里有的文件"
	);
	// 引用一个 map 里没有的路径时，定位也应当失败而不是抛错。
	assertEqual(resolveEntry(map, { path: "题库/不存在.md", id: "a1" }), undefined, "缺失文件的题目查不到");
});

// ---------------------------------------------------------------------------
// shuffleWith / sampleWith
// ---------------------------------------------------------------------------

test("洗牌：长度不变、元素不重复、不改动入参", () => {
	const items = ["a", "b", "c", "d"];
	const shuffled = shuffleWith(items, seededRandom(11));
	assertEqual(shuffled.length, items.length, "长度不变");
	assertEqual([...shuffled].sort().join(","), "a,b,c,d", "元素集合不变");
	assertEqual(items.join(","), "a,b,c,d", "入参不应被改动");
});

test("洗牌：空数组与单元素数组原样返回", () => {
	assertEqual(shuffleWith([], constantRandom(0.5)).length, 0, "空数组");
	assertEqual(shuffleWith(["a"], constantRandom(0.5)).join(""), "a", "单元素数组");
});

test("洗牌：固定随机序列得到确定结果", () => {
	const items = ["a", "b", "c", "d"];
	assertEqual(shuffleWith(items, constantRandom(0.5)).join(""), "adbc", "常量 0.5 的确定排列");
	assertEqual(shuffleWith(items, constantRandom(0)).join(""), "bcda", "常量 0 的确定排列");
});

test("洗牌：同一种子得到同一结果", () => {
	const items = ["a", "b", "c", "d", "e", "f"];
	assertEqual(
		shuffleWith(items, seededRandom(7)).join(""),
		shuffleWith(items, seededRandom(7)).join(""),
		"同种子应可复现"
	);
});

test("抽样：数量正确、不重复、不改动入参", () => {
	const pool = ["a", "b", "c", "d", "e"];
	const picked = sampleWith(pool, 3, seededRandom(5));
	assertEqual(picked.length, 3, "应取 3 项");
	assertEqual(new Set(picked).size, 3, "不应有重复项");
	assert(picked.every((item) => pool.includes(item)), "只能取自入参");
	assertEqual(pool.join(","), "a,b,c,d,e", "入参不应被改动");
});

test("抽样：固定随机序列得到确定结果", () => {
	assertEqual(sampleWith(["a", "b", "c", "d"], 2, constantRandom(0.5)).join(""), "ad", "常量 0.5 时应取到 a、d");
	assertEqual(sampleWith(["a", "b", "c", "d"], 1, constantRandom(0)).join(""), "b", "常量 0 时应取到 b");
});

test("抽样：count 超过池子大小时返回全部（打乱后）", () => {
	const pool = ["a", "b", "c"];
	const picked = sampleWith(pool, 10, constantRandom(0.5));
	assertEqual(picked.length, 3, "应返回全部");
	assertEqual([...picked].sort().join(","), "a,b,c", "元素集合不变");
	assertEqual(pool.join(","), "a,b,c", "入参不应被改动");
});

test("抽样：count <= 0 时返回全部（打乱后）", () => {
	const picked = sampleWith(["a", "b", "c"], 0, seededRandom(1));
	assertEqual(picked.length, 3, "0 表示全部");
	assertEqual(new Set(picked).size, 3, "不应有重复项");
});

// ---------------------------------------------------------------------------
// sessionProgress
// ---------------------------------------------------------------------------

test("进度：按已作答数计算百分比", () => {
	const progress = sessionProgress(2, 4, [true, false, null, null]);
	assertEqual(progress.index, 2, "当前下标");
	assertEqual(progress.total, 4, "总题数");
	assertEqual(progress.answered, 2, "已作答两道");
	assertEqual(progress.correct, 1, "答对一道");
	assertEqual(progress.wrong, 1, "答错一道");
	assertEqual(progress.percent, 50, "2/4 应为 50%");
});

test("进度：百分比四舍五入取整", () => {
	assertEqual(sessionProgress(1, 3, [true, null, null]).percent, 33, "1/3 应取 33");
	assertEqual(sessionProgress(2, 3, [true, true, null]).percent, 67, "2/3 应取 67");
});

test("进度：index 会被夹到 [0, total]", () => {
	const before = sessionProgress(-5, 3, [null, null, null]);
	assertEqual(before.index, 0, "负数下标夹到 0");
	assertEqual(before.answered, 0, "夹到 0 时没有已作答项");
	assertEqual(before.percent, 0, "百分比为 0");

	const after = sessionProgress(10, 3, [true, false, null]);
	assertEqual(after.index, 3, "越界下标夹到 total");
	assertEqual(after.answered, 2, "只有前两项作答过");
	assertEqual(after.percent, 67, "2/3 应取 67");
});

test("进度：total 为 0 时百分比为 0", () => {
	const progress = sessionProgress(0, 0, []);
	assertEqual(progress.total, 0, "总题数");
	assertEqual(progress.answered, 0, "已作答数量");
	assertEqual(progress.percent, 0, "没有题时不应出现 NaN");
});

test("进度：下标之后的作答结果不参与统计", () => {
	const progress = sessionProgress(1, 3, [true, false, true]);
	assertEqual(progress.answered, 1, "只统计下标之前的项");
	assertEqual(progress.correct, 1, "答对数");
	assertEqual(progress.wrong, 0, "答错数");
});

// ---------------------------------------------------------------------------
// resolveEntry
// ---------------------------------------------------------------------------

test("定位：能找回队列项对应的题目", () => {
	const map = buildMap();
	const question = must(resolveEntry(map, { path: pathA, id: "a2" }), "应找回甲二");
	assertEqual(question.title, "甲二", "找回的应是同一道题");
	assertEqual(question.type, "single", "题型");
	assertEqual(resolveEntry(map, { path: pathB, id: "b1" })?.stats.lastResult, "wrong", "stats 也应是最新的解析结果");
});

test("定位：id 不存在时返回 undefined", () => {
	assertEqual(resolveEntry(buildMap(), { path: pathA, id: "查无此题" }), undefined, "找不到 id 时不应抛错");
});

test("定位：文件不存在时返回 undefined", () => {
	assertEqual(resolveEntry(buildMap(), { path: "题库/缺失.md", id: "a1" }), undefined, "找不到文件时不应抛错");
});

test("汇总行：按题型计数可以直接按题型键读取", () => {
	const row: FileSummary = summary;
	assertEqual(row.byType.single, 1, "单选题数");
	assertEqual(row.byType.essay, 0, "没有问答题");
	assertEqual(TYPE_ORDER.every((type) => typeof row.byType[type] === "number"), true, "每种题型都应有计数");
});
