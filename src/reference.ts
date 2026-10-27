/**
 * 题目 id 引用的纯逻辑：把笔记里的内联代码 `` `题目id` `` 解析成题库里的一道题。
 *
 * 沿用嵌入的判定原则：宁可放过，不可误伤。只有整段内联代码就是 id、且能唯一定位到
 * 一道可作答的题时才接管；其余情况（普通代码、未知 id、多份题库里重名）一律保持原样。
 */

import { QuizQuestion } from "./types";

/** 一道可被引用的题：题库路径 + 题目 id（+ 标题，便于诊断）。 */
export interface QuestionReferenceTarget {
	path: string;
	id: string;
	title: string;
}

/** 一个题库文件的解析结果里参与建索引的题。 */
export interface ReferenceBank {
	path: string;
	questions: readonly QuizQuestion[];
}

/**
 * 判断内联代码是否可能是题目 id。
 *
 * 空串、含空白或换行的代码都不是 id——那些是用户真正的代码片段。返回 null 表示
 * "别管它"；返回值保持原样（不做大小写或空白归一化，id 是大小写敏感的）。
 */
export function parseReferenceId(raw: string): string | null {
	if (raw === "" || raw !== raw.trim()) return null;
	if (/\s/.test(raw)) return null;
	return raw;
}

/**
 * 建立 id → 题目 的索引。只收录可作答（`ok`）的题；同一 id 出现在多道题里时全部保留，
 * 由 {@link pickReference} 决定能不能唯一定位。
 */
export function buildReferenceIndex(
	banks: readonly ReferenceBank[]
): Map<string, QuestionReferenceTarget[]> {
	const index = new Map<string, QuestionReferenceTarget[]>();
	for (const bank of banks) {
		for (const question of bank.questions) {
			if (!question.ok) continue;
			const target: QuestionReferenceTarget = {
				path: bank.path,
				id: question.id,
				title: question.title,
			};
			const existing = index.get(question.id);
			if (existing === undefined) index.set(question.id, [target]);
			else existing.push(target);
		}
	}
	return index;
}

/**
 * 从同名命中里挑出唯一一道题。
 *
 * 规则：优先当前笔记自己的题（同一 id 在两份题库里重复时，引用至少还有个合理猜测），
 * 其次整个 vault 里唯一；其余情况（多道候选）返回 null，交给调用方保持代码原样。
 */
export function pickReference(
	hits: readonly QuestionReferenceTarget[],
	sourcePath: string
): QuestionReferenceTarget | null {
	const local = hits.filter((hit) => hit.path === sourcePath);
	const candidates = local.length > 0 ? local : hits;
	return candidates.length === 1 ? (candidates[0] ?? null) : null;
}
