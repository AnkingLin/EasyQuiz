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
	/** 配对：条目 key → 所选基准条目的 key（用条目文本比较）。 */
	| { kind: "match"; pairs: { key: string; target: string }[] }
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
			return gradeMatch(question, answer as { kind: "match"; pairs: { key: string; target: string }[] });
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

function gradeMatch(
	question: QuizQuestion,
	answer: { kind: "match"; pairs: { key: string; target: string }[] }
): GradeResult {
	const details: GradeDetail[] = [];
	const recorded: string[] = [];

	for (const column of question.matchColumns) {
		for (const entry of column.entries) {
			const chosen = answer.pairs.find((pair) => pair.key === entry.key);
			const target = (chosen?.target ?? "").trim();
			recorded.push(`${entry.key}=${target}`);
			// 一对多时同一左侧条目有多个可接受答案，命中任一即算对（合并选项）。
			const acceptable = entry.actualTargets;
			const matched =
				target !== "" && acceptable.some((candidate) => normalizeText(candidate) === normalizeText(target));
			const where = question.matchColumns.length > 1 ? `（${column.name}）` : "";
			details.push({
				correct: matched,
				note: matched ? undefined : `「${entry.text}」${where}应匹配「${acceptable.join(" / ")}」`,
			});
		}
	}

	return { correct: details.length > 0 && details.every((detail) => detail.correct), details, recorded };
}

function gradeEssay(answer: { kind: "essay"; result: "correct" | "wrong" }): GradeResult {
	const correct = answer.result === "correct";
	return {
		correct,
		details: [{ correct, note: correct ? undefined : "已标记为未掌握" }],
		recorded: answer.result,
	};
}

function normalizeText(text: string): string {
	return text.replace(/\s+/g, "").trim();
}
