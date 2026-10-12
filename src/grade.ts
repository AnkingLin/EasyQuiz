/**
 * 判分逻辑（纯函数，不依赖 obsidian）。
 *
 * 判分依据是稳定锚点而不是选项位置，因此插入、删除、重排选项都不会让结果错位。
 */

import { BlankRule, QuizQuestion } from "./types";

export type UserAnswer =
	/** 单选 / 多选：所选选项锚点。 */
	| { kind: "choice"; anchors: string[] }
	/** 填空：按题面顺序给出的每空输入。 */
	| { kind: "blank"; values: string[] }
	/** 配对：相邻两列之间的连线（条目 key 对）。 */
	| { kind: "match"; pairs: { left: string; right: string }[] }
	/** 问答：自评。 */
	| { kind: "essay"; result: "correct" | "wrong" };

export interface GradeDetail {
	/** 该部分是否答对。 */
	correct: boolean;
	/** 人类可读的说明，用于结果面板。 */
	note?: string;
}

export interface GradeResult {
	correct: boolean;
	details: GradeDetail[];
	/** 用于写回 history 的答案摘要。 */
	recorded: string | string[];
}

/**
 * 判定一次作答。题目不可作答（`ok === false`）时抛出，调用方应先检查 `ok`。
 */
export function gradeAnswer(question: QuizQuestion, answer: UserAnswer): GradeResult {
	if (!question.ok) {
		throw new Error(`题目「${question.title}」当前不可作答：${question.warnings.map((w) => w.message).join("；")}`);
	}

	switch (question.type) {
		case "single":
		case "multi":
			return gradeChoice(question, answer as { kind: "choice"; anchors: string[] });
		case "blank":
			return gradeBlank(question, answer as { kind: "blank"; values: string[] });
		case "match":
			return gradeMatch(question, answer as { kind: "match"; pairs: { left: string; right: string }[] });
		case "essay":
			return gradeEssay(answer as { kind: "essay"; result: "correct" | "wrong" });
		default:
			throw new Error("未知题型，无法判分。");
	}
}

function gradeChoice(question: QuizQuestion, answer: { kind: "choice"; anchors: string[] }): GradeResult {
	const expected = normalizeAnchors(
		Array.isArray(question.answer) ? question.answer : question.answer === null ? [] : [question.answer]
	);
	const actual = normalizeAnchors(answer.anchors);

	const missing = expected.filter((anchor) => !actual.includes(anchor));
	const extra = actual.filter((anchor) => !expected.includes(anchor));
	const correct = missing.length === 0 && extra.length === 0;

	return {
		correct,
		details: [
			{
				correct,
				note: correct
					? undefined
					: [
							missing.length > 0 ? `漏选：${missing.map(labelOf(question, "缺少")).join("、")}` : "",
							extra.length > 0 ? `多选：${extra.join("、")}` : "",
						]
							.filter(Boolean)
							.join("；"),
			},
		],
		recorded: actual,
	};
}

function labelOf(question: QuizQuestion, _kind: string) {
	return (anchor: string): string => {
		const option = question.options.find((item) => item.anchor === anchor);
		return option ? `${anchor}（${option.text}）` : anchor;
	};
}

function normalizeAnchors(anchors: string[]): string[] {
	return [...new Set(anchors.map((anchor) => anchor.trim()).filter((anchor) => anchor !== ""))].sort();
}

function gradeBlank(question: QuizQuestion, answer: { kind: "blank"; values: string[] }): GradeResult {
	const details: GradeDetail[] = [];
	const recorded: string[] = [];

	for (let index = 0; index < question.blanks.length; index++) {
		const blank = question.blanks[index];
		if (blank === undefined) continue;
		const value = (answer.values[index] ?? "").trim();
		recorded.push(value);
		const rule = question.blankRules[blank.anchor] ?? {};
		const matched = matchBlank(value, blank.expected, rule);
		details.push({
			correct: matched,
			note: matched ? undefined : `第 ${index + 1} 空应为「${blank.expected}」`,
		});
	}

	return { correct: details.every((detail) => detail.correct), details, recorded };
}

/** 按规则比较一次填空输入。默认精确匹配（去首尾空白）。 */
export function matchBlank(value: string, expected: string, rule: BlankRule): boolean {
	const candidates = rule.accept && rule.accept.length > 0 ? rule.accept : [expected];
	const normalize = (text: string): string => {
		const trimmed = text.trim();
		return rule.ignoreCase ? trimmed.toLowerCase() : trimmed;
	};
	if (rule.regex) {
		return candidates.some((candidate) => {
			try {
				return new RegExp(candidate).test(value.trim());
			} catch {
				return false;
			}
		});
	}
	const normalizedValue = normalize(value);
	return candidates.some((candidate) => normalize(candidate) === normalizedValue);
}

/**
 * 连线题判分。
 *
 * 连线发生在相邻两列之间，因此逐条比较"正确答案"与"玩家连线"：
 * 方向无关（左→右与右→左是同一条线），一条不多、一条不少才算全对。
 */
function gradeMatch(
	question: QuizQuestion,
	answer: { kind: "match"; pairs: { left: string; right: string }[] }
): GradeResult {
	// 玩家连线统一成规范化的 `小列~大列`；方向无关，同一对的两个方向视为同一条。
	const expected = new Set(question.boardPairs.map((pair) => `${pair.left}~${pair.right}`));
	const normalize = (first: string, second: string): string | null => {
		if (first === second) return null;
		const forward = `${first}~${second}`;
		if (expected.has(forward)) return forward;
		const backward = `${second}~${first}`;
		if (expected.has(backward)) return backward;
		// 不在正确答案里：保留原始方向用于提示。
		return forward;
	};

	const chosen = new Set<string>();
	const chosenPairs: { left: string; right: string }[] = [];
	for (const pair of answer.pairs) {
		const key = normalize(pair.left, pair.right);
		if (key === null || chosen.has(key)) continue;
		chosen.add(key);
		const [left, right] = splitPair(key);
		if (left !== null && right !== null) chosenPairs.push({ left, right });
	}
	const itemText = new Map<string, string>();
	for (const column of question.board) {
		for (const item of column.items) itemText.set(item.key, item.text);
	}
	const label = (key: string): string => itemText.get(key) ?? key;

	const details: GradeDetail[] = [];
	const recorded: string[] = [];

	// 漏连：正确答案里玩家没连的。
	for (const pair of question.boardPairs) {
		const key = `${pair.left}~${pair.right}`;
		recorded.push(key);
		if (chosen.has(key)) continue;
		details.push({
			correct: false,
			note: `缺少连线：「${label(pair.left)}」—「${label(pair.right)}」`,
		});
	}

	// 多连：玩家连了但不在正确答案里。
	for (const pair of chosenPairs) {
		const key = `${pair.left}~${pair.right}`;
		if (expected.has(key)) continue;
		details.push({
			correct: false,
			note: `多余的连线：「${label(pair.left)}」—「${label(pair.right)}」`,
		});
	}

	if (details.length === 0) {
		details.push({ correct: true });
	}

	return {
		correct: details.every((detail) => detail.correct),
		details,
		recorded,
	};
}

function gradeEssay(answer: { kind: "essay"; result: "correct" | "wrong" }): GradeResult {
	const correct = answer.result === "correct";
	return {
		correct,
		details: [{ correct, note: correct ? undefined : "已标记为未掌握" }],
		recorded: answer.result,
	};
}

/** 拆开规范化后的连线 key。 */
function splitPair(key: string): [string | null, string | null] {
	const separator = key.indexOf("~");
	if (separator <= 0) return [null, null];
	return [key.slice(0, separator), key.slice(separator + 1)];
}
