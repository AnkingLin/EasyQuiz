/**
 * 数据块 → 题目的映射（纯逻辑，不依赖 obsidian）。
 *
 * 阅读视图的代码块处理器只拿到源码与行号区间，需要把它对应回解析结果里的
 * 某一道题；单独成模块后这条规则可以在 node 下测试，main.ts 也能保持精简。
 */

import { ParsedQuizFile, QuizQuestion } from "./types";

/**
 * 把数据块对应到题目：优先用行号区间，其次用源码内容比对。
 *
 * 行号区间由 `getSectionInfo` 给出；两者都对不上时返回 null，由调用方显示诊断。
 */
export function findQuestion(
	parsed: ParsedQuizFile,
	section: { lineStart: number; lineEnd: number } | null,
	source: string
): QuizQuestion | null {
	if (section) {
		const inside = parsed.questions.filter(
			(question) =>
				question.blockLine !== null &&
				question.blockLine >= section.lineStart &&
				question.blockLine <= section.lineEnd
		);
		const first = inside[0];
		if (first !== undefined) return first;
	}
	const normalized = source.trim();
	const bySource = parsed.questions.filter(
		(question) => question.blockSource !== null && question.blockSource.trim() === normalized
	);
	return bySource[0] ?? null;
}
