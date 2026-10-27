/**
 * 写回做题记录（纯逻辑，不依赖 obsidian）。
 *
 * 方案约束（README §3）：记录只写在笔记内，因此必须
 *   - 只改动数据块内的 `stats` / `history` / `rev`，其余内容逐字不动；
 *   - 写入前校验补丁结果，宁可写不进去也不写坏笔记；
 *   - 由调用方用 Vault.process 做原子读改写。
 */

import { t } from "./i18n";
import { analyzeFences, ParseDependencies, ParseOptions } from "./parser";
import { HistoryEntry, QuizStats } from "./types";

/**
 * 写回所需依赖。形状与 {@link ParseOptions} 一致（`deps` 单独传），
 * 这样调用方可以把同一份解析设置直接传进来，避免两处各写一套而产生错配。
 */
export interface WriteBackDeps extends Omit<ParseOptions, "deps"> {
	deps: ParseDependencies;
}

export interface WriteBackPatch {
	/** 打补丁后的数据块内层源码。 */
	content: string;
	/** 是否成功定位并更新（false 表示数据块找不到）。 */
	applied: boolean;
	/** 未应用的原因，用于界面提示。 */
	reason?: string;
}

/** 默认保留的历史条数；超出丢弃最旧的。`0` 表示只留汇总。 */
export const DEFAULT_HISTORY_LIMIT = 10;

/**
 * 校验数据块源码是否是合法的 YAML 键值映射。
 *
 * 这里刻意不经过题库解析器：写回只需要"YAML 仍然合法"，
 * 不该因为题目本身缺 `type`（如正在修题）就拒绝写入。
 */
function isMapping(blockSource: string, deps: WriteBackDeps): boolean {
	try {
		const loaded = deps.deps.parseYaml(blockSource);
		return loaded !== null && typeof loaded === "object" && !Array.isArray(loaded);
	} catch {
		return false;
	}
}

function isKnownKey(line: string, key: string): boolean {
	return new RegExp(`^${key}\\s*:`).test(line);
}

function formatStats(stats: QuizStats): string {
	const parts = [
		`attempts: ${stats.attempts}`,
		`correct: ${stats.correct}`,
		`lastResult: ${stats.lastResult ?? "null"}`,
		`lastAt: ${stats.lastAt ?? "null"}`,
	];
	return `stats: { ${parts.join(", ")} }`;
}

function formatHistory(history: HistoryEntry[]): string {
	if (history.length === 0) {
		return "history: []";
	}
	const lines = history.map((entry) => {
		const parts = [`at: ${entry.at}`, `result: ${entry.result}`];
		if (entry.answer !== undefined) {
			parts.push(`answer: ${JSON.stringify(entry.answer)}`);
		}
		if (entry.ms !== undefined) {
			parts.push(`ms: ${entry.ms}`);
		}
		return `  - { ${parts.join(", ")} }`;
	});
	return ["history:", ...lines].join("\n");
}

/**
 * 用补丁替换或追加数据块内的字段，逐行处理以保留其余内容与注释。
 *
 * @param blockSource 数据块内层源码。
 * @param updates 键 → 新的 YAML 片段（可能多行）。
 */
export function patchBlockSource(blockSource: string, updates: Record<string, string>): string {
	const lines = blockSource.replace(/\r\n?/g, "\n").split("\n");
	const consumed = new Set<string>();

	const result: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const key = Object.keys(updates).find(
			(candidate) => !consumed.has(candidate) && isKnownKey(line, candidate)
		);
		const replacement = key === undefined ? undefined : updates[key];
		if (key === undefined || replacement === undefined) {
			result.push(line);
			continue;
		}
		consumed.add(key);
		// 块状形式（如 `history:` 后跟缩进列表）需要连带吞掉其子行。
		const inline = /:\s*\S/.test(line);
		result.push(replacement);
		if (!inline) {
			while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1] ?? "")) i++;
		}
	}

	// 没有出现过的键：追加到数据块末尾。
	const additions = Object.keys(updates).filter((key) => !consumed.has(key));
	if (additions.length > 0) {
		if (result.length > 0 && (result[result.length - 1] ?? "").trim() !== "") result.push("");
		for (const key of additions) {
			const value = updates[key];
			if (value !== undefined) result.push(value);
		}
	}

	return result.join("\n").replace(/^\n+|\n+$/g, "");
}

/**
 * 从数据块源码里删掉指定键（连同它下面缩进的子行）。
 *
 * 与 `patchBlockSource` 的分工：那个函数负责"更新已有的键"，这里负责把
 * `stats` / `history` 这类记录整个拿掉，让题目回到"未作答"的样子。
 */
export function removeBlockKeys(blockSource: string, keys: readonly string[]): string {
	const lines = blockSource.replace(/\r\n?/g, "\n").split("\n");
	const result: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (skipping) {
			if (/^\s+\S/.test(line)) continue;
			// 记录块后面的空行也一并收掉，避免留下连续空行。
			if (line.trim() === "") {
				skipping = false;
				continue;
			}
			skipping = false;
		}
		if (keys.some((key) => isKnownKey(line, key))) {
			skipping = true;
			continue;
		}
		result.push(line);
	}
	return result.join("\n").replace(/^\n+|\n+$/g, "");
}

/** 清除一条记录后的数据块内容。 */
export interface ClearPatch {
	content: string;
	applied: boolean;
	reason?: string;
}

/**
 * 计算"清除做题记录"后的数据块内容。
 *
 * 只动 `stats` 与 `history`：`rev` 记录的是题面结构版本，清记录不该让它失效。
 * 与写回一样，补丁结果必须仍是合法 YAML 映射，否则宁可不清也不写坏笔记。
 */
export function planClear(blockSource: string, deps: WriteBackDeps): ClearPatch {
	const content = removeBlockKeys(blockSource, ["stats", "history"]);
	if (!isMapping(content, deps)) {
		return { content: blockSource, applied: false, reason: t("writeback.invalidYaml") };
	}
	return { content, applied: true };
}

/**
 * 计算「关闭题面变更提示」后的数据块内容。
 *
 * 只把 `rev` 更新成当前题面的版本：作者确认"我知道题面改过了"，
 * 提示因此消失，但作答记录原样保留。
 */
export function planAcceptStem(blockSource: string, rev: string, deps: WriteBackDeps): ClearPatch {
	const content = patchBlockSource(blockSource, { rev: `rev: ${JSON.stringify(rev)}` });
	if (!isMapping(content, deps)) {
		return { content: blockSource, applied: false, reason: t("writeback.invalidYaml") };
	}
	return { content, applied: true };
}

/**
 * 计算写回后的数据块内容。
 *
 * 与 `patchBlockSource` 的区别：这里会先用解析器校验补丁结果，
 * 校验不通过时拒绝写入（宁可丢一次记录，也不写坏用户的笔记）。
 */
export function planWriteBack(
	blockSource: string,
	stats: QuizStats,
	history: HistoryEntry[],
	rev: string,
	deps: WriteBackDeps,
	historyLimit: number = DEFAULT_HISTORY_LIMIT
): WriteBackPatch {
	const trimmedHistory = historyLimit > 0 ? history.slice(-historyLimit) : [];
	const updates: Record<string, string> = {
		stats: formatStats(stats),
		rev: `rev: ${rev}`,
	};
	// `history: []` 也不写空数组，避免给笔记添无意义的行。
	if (trimmedHistory.length > 0 || /^\s*history\s*:/m.test(blockSource)) {
		updates["history"] = formatHistory(trimmedHistory);
	}

	const content = patchBlockSource(blockSource, updates);

	// 校验：补丁结果必须仍是合法 YAML 映射，否则放弃写入以保护笔记。
	if (!isMapping(content, deps)) {
		return { content: blockSource, applied: false, reason: t("writeback.invalidYaml") };
	}

	return { content, applied: true };
}

/**
 * 在整份文件文本中替换数据块内容。
 *
 * @param fileText 文件全文。
 * @param blockLine 数据块开围栏行号（0 基，来自解析结果）。
 * @param newBlockSource 新的数据块内层源码。
 * @returns 替换后的文件全文；无法定位时返回 null。
 */
export function replaceBlockInFile(
	fileText: string,
	blockLine: number,
	newBlockSource: string,
	blockLanguage = "quiz"
): string | null {
	const lines = fileText.replace(/\r\n?/g, "\n").split("\n");
	if (blockLine < 0 || blockLine >= lines.length) return null;

	const fences = analyzeFences(lines);
	const state = fences[blockLine];
	if (!state || state.kind !== "open" || state.language !== blockLanguage) return null;

	// 找闭围栏：同块内 kind === "close" 的第一行。
	let closeLine = lines.length;
	for (let i = blockLine + 1; i < lines.length; i++) {
		const fence = fences[i];
		if (fence === undefined) continue;
		if (fence.kind === "close" && fence.openLine === blockLine) {
			closeLine = i;
			break;
		}
		if (fence.kind === "open") break;
	}

	const before = lines.slice(0, blockLine + 1);
	const after = lines.slice(closeLine);
	return [...before, ...newBlockSource.split("\n"), ...after].join("\n");
}
