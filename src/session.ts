/**
 * 刷题会话的纯逻辑（不依赖 obsidian，可在 node 下直接运行）。
 *
 * 设计原则：
 *   - 本文件不读文件系统：`path` 与 `mtime` 都由调用方传入，作者信息只从解析结果里取，
 *     因此它可以在 node 下被测（见 tests/quiz-session.test.ts）。
 *   - 队列项只记录「文件路径 + 题目 id」这一对稳定引用，不持有题目对象：
 *     题目内容会随文件改动而变，引用越轻越不容易失真，需要时用 `resolveEntry` 取回最新解析结果。
 *   - 「选哪些题」（筛选）与「取多少、什么顺序」（抽取）分开：
 *     设置页改一项不会连带影响另一项，行为也容易解释。
 *   - 全部随机都走可注入的 `random` 参数，测试可以给出确定序列，不必依赖 Math.random 的分布。
 *   - 作答记录只统计**可作答题**（`ok === true`）：降级题的 stats 不可信，宁可少算也不误导作者。
 */

import { ParsedQuizFile, QUIZ_TYPES, QuizQuestion, QuizType } from "./types";
import type { QuizService } from "./runtime";

// 本模块只消费 QuizService 解析出的结果，不调用它（因此不引入 obsidian 运行时依赖）；
// 这里把服务类型一并转出去，上层需要「会话配置 + 解析服务」时从一个地方取类型就够了。
export type { QuizService };

/** 汇总一行的键：文件路径。 */
export type FileSummaryKey = string;

/** 一个题库文件的汇总统计。 */
export interface FileSummary {
	path: string;
	/** 所属文件夹（vault 根为 ""）。 */
	folder: string;
	/** 文件最后修改时间（毫秒；未知为 0）。 */
	mtime: number;
	/** 题面标题数（含降级题）。 */
	total: number;
	/** 可作答题数（ok === true）。 */
	answerable: number;
	/** 降级题数（ok === false）。 */
	broken: number;
	/** 需要修正的提示条数：降级题自身的提示 + 文件级提示。 */
	issues: number;
	/** 按题型统计的可作答题数。 */
	byType: Record<QuizType, number>;
	/** 全部作答次数之和。 */
	attempts: number;
	/** 答对次数之和。 */
	correct: number;
	/** 最近一次作答时间（ISO 字符串），无记录为 null。 */
	lastAt: string | null;
}

/** 按题型顺序固定的题型列表（与插入模板/卡片标签的顺序一致）。 */
export const TYPE_ORDER: readonly QuizType[] = [...QUIZ_TYPES];

/** 全零的题型计数表。用 TYPE_ORDER 生成，将来新增题型不会漏键。 */
function emptyTypeCounts(): Record<QuizType, number> {
	return Object.fromEntries(TYPE_ORDER.map((type) => [type, 0])) as Record<QuizType, number>;
}

/** 取路径所属文件夹：vault 根下的文件返回 ""。 */
function folderOf(path: string): string {
	const separator = path.lastIndexOf("/");
	return separator < 0 ? "" : path.slice(0, separator);
}

/** 汇总一个已解析文件。 */
export function summarizeFile(parsed: ParsedQuizFile, path: string, mtime: number): FileSummary {
	const byType = emptyTypeCounts();
	let total = 0;
	let answerable = 0;
	let broken = 0;
	let issues = 0;
	let attempts = 0;
	let correct = 0;
	let lastAt: string | null = null;

	for (const question of parsed.questions) {
		total++;
		if (!question.ok) {
			// 降级题只贡献「待修正」计数：它的 stats 不可信，不算进作答数据。
			broken++;
			issues += question.warnings.length;
			continue;
		}
		answerable++;
		if (question.type !== null) byType[question.type]++;
		attempts += question.stats.attempts;
		correct += question.stats.correct;
		// ISO 字符串按字典序即可比较先后；没有记录（null）的一律忽略。
		const at = question.stats.lastAt;
		if (at !== null && (lastAt === null || at > lastAt)) lastAt = at;
	}

	// 文件级提示（questionIndex === null）不属于任何一道题，单独累加。
	issues += parsed.warnings.filter((warning) => warning.questionIndex === null).length;

	return {
		path,
		folder: folderOf(path),
		mtime,
		total,
		answerable,
		broken,
		issues,
		byType,
		attempts,
		correct,
		lastAt,
	};
}

/** 汇总的列表级合计。 */
export interface SummaryTotals {
	files: number;
	questions: number;
	answerable: number;
	broken: number;
	issues: number;
	attempts: number;
	correct: number;
}

/** 汇总一组文件统计。空列表返回全零，不会算出 NaN。 */
export function summarizeAll(summaries: readonly FileSummary[]): SummaryTotals {
	const totals: SummaryTotals = {
		files: 0,
		questions: 0,
		answerable: 0,
		broken: 0,
		issues: 0,
		attempts: 0,
		correct: 0,
	};
	for (const summary of summaries) {
		totals.files++;
		totals.questions += summary.total;
		totals.answerable += summary.answerable;
		totals.broken += summary.broken;
		totals.issues += summary.issues;
		totals.attempts += summary.attempts;
		totals.correct += summary.correct;
	}
	return totals;
}

/** 刷题模式。 */
export type PracticeMode = "order" | "random" | "wrong";

export interface SessionConfig {
	mode: PracticeMode;
	/** random 模式的抽取数量；<= 0 表示全部。 */
	randomCount: number;
	/** 空集合表示不限题型。 */
	types: QuizType[];
	/** 是否包含解析失败的降级题（默认 false）。 */
	includeBroken: boolean;
	/** 只保留上一次作答错误的题（wrong 模式）。 */
	wrongOnly: boolean;
	/** 打乱题序（random 模式恒为 true，由 buildSession 处理）。 */
	shuffle: boolean;
	/** 打乱选项顺序。 */
	shuffleOptions: boolean;
}

/** 设置页的默认值。 */
export const DEFAULT_SESSION_CONFIG: SessionConfig = {
	mode: "order",
	randomCount: 20,
	types: [],
	includeBroken: false,
	wrongOnly: false,
	shuffle: false,
	shuffleOptions: false,
};

/** 题目引用：跨题库文件唯一。 */
export interface QuestionRef {
	path: string;
	id: string;
}

/** 队列里的一项。 */
export interface QueueEntry extends QuestionRef {
	/** 稳定展示名：题面标题。 */
	title: string;
}

/** 一个文件的解析结果（键为路径）。 */
export type ParsedMap = Map<string, ParsedQuizFile>;

/** 筛选条件（是 SessionConfig 里与"选哪些题"有关的那部分）。 */
export interface QuestionFilter {
	types: QuizType[];
	includeBroken: boolean;
	wrongOnly: boolean;
}

/** 按题型 / 是否降级 / 是否只留上次答错的题筛选。 */
export function filterQuestions(questions: readonly QuizQuestion[], filter: QuestionFilter): QuizQuestion[] {
	const result: QuizQuestion[] = [];
	for (const question of questions) {
		// 降级题默认剔除；`type === null` 的题没有题型，只有显式带上降级题时才可能留下。
		if (!question.ok && !filter.includeBroken) continue;
		if (question.type === null && !filter.includeBroken) continue;
		// 空集合表示不限题型；没有任何题型的题（type === null）不会命中非空题型集合。
		if (filter.types.length > 0 && (question.type === null || !filter.types.includes(question.type))) continue;
		if (filter.wrongOnly && question.stats.lastResult !== "wrong") continue;
		result.push(question);
	}
	return result;
}

/**
 * 按照配置生成刷题队列。
 *
 * - 先按题型 / 降级 / 错题筛选，再决定顺序与数量；
 * - `wrongOnly` 与 `mode: "wrong"` 是同一个条件的两种写法，任何模式下都只留上次答错的题；
 * - `mode: "random"` 恒为「打乱后抽取 `randomCount` 条」，`randomCount <= 0` 表示全部；
 * - `mode: "order"` / `"wrong"` 默认保持文件与题面顺序，作者显式打开 `shuffle` 时才打乱。
 *
 * @param parsedByPath 已解析的文件；map 之外的路径不会被引用。
 */
export function buildSession(
	config: SessionConfig,
	parsedByPath: ParsedMap,
	random: () => number = Math.random
): QueueEntry[] {
	const filter: QuestionFilter = {
		types: config.types,
		includeBroken: config.includeBroken,
		wrongOnly: config.wrongOnly || config.mode === "wrong",
	};

	const pool: QueueEntry[] = [];
	for (const [path, parsed] of parsedByPath) {
		// 只遍历解析结果里的文件：队列项因此一定能在 resolveEntry 里找回来。
		for (const question of filterQuestions(parsed.questions, filter)) {
			pool.push({ path, id: question.id, title: question.title });
		}
	}

	if (config.mode === "random") {
		// sampleWith 内部总是先打乱，因此 `randomCount <= 0` 得到的就是打乱后的全量。
		return sampleWith(pool, config.randomCount, random);
	}
	return config.shuffle ? shuffleWith(pool, random) : pool;
}

/** 从解析结果里找回队列项对应的题目；文件或题目不存在时返回 undefined。 */
export function resolveEntry(parsedByPath: ParsedMap, entry: QuestionRef): QuizQuestion | undefined {
	const parsed = parsedByPath.get(entry.path);
	if (parsed === undefined) return undefined;
	return parsed.questions.find((question) => question.id === entry.id);
}

/** 一次刷题的实时进度。 */
export interface SessionProgress {
	index: number;
	total: number;
	correct: number;
	wrong: number;
	/** 已作答数量。 */
	answered: number;
	/** 已完成百分比（0–100，取整）。 */
	percent: number;
}

/** 按队列长度与逐题结果算出进度（只统计下标之前的已作答项）。 */
export function sessionProgress(
	index: number,
	total: number,
	results: readonly (boolean | null)[]
): SessionProgress {
	const safeTotal = Math.max(0, Math.trunc(total));
	const safeIndex = Math.min(Math.max(0, Math.trunc(index)), safeTotal);

	let answered = 0;
	let correct = 0;
	let wrong = 0;
	for (let i = 0; i < safeIndex; i++) {
		const result = results[i];
		if (result === undefined || result === null) continue;
		answered++;
		if (result) correct++;
		else wrong++;
	}

	return {
		index: safeIndex,
		total: safeTotal,
		correct,
		wrong,
		answered,
		percent: safeTotal === 0 ? 0 : Math.round((answered / safeTotal) * 100),
	};
}

/** 把随机下标夹到 `[0, max]`：`random` 返回 1 或非有限值时也不会越界。 */
function clampIndex(value: number, max: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(Math.max(0, Math.trunc(value)), max);
}

/** 打乱一个新数组，不改动入参（Fisher–Yates，从后往前与 `[0, i]` 内的随机位置交换）。 */
export function shuffleWith<T>(items: readonly T[], random: () => number = Math.random): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = clampIndex(Math.floor(random() * (i + 1)), i);
		const current = result[i];
		const other = result[j];
		if (current === undefined || other === undefined) continue;
		result[i] = other;
		result[j] = current;
	}
	return result;
}

/** 从数组里随机取不重复的 count 项（count <= 0 或超过长度时返回全部打乱后的数组）。 */
export function sampleWith<T>(items: readonly T[], count: number, random: () => number = Math.random): T[] {
	const shuffled = shuffleWith(items, random);
	if (count <= 0 || count >= shuffled.length) return shuffled;
	return shuffled.slice(0, count);
}
