/**
 * 插件设置的形状、默认值与校验（纯逻辑，不依赖 obsidian）。
 *
 * `data.json` 是用户/同步工具可直接编辑的文件，读出来的值可能是任意类型。
 * 这里把每个字段收敛回合法值：坏字段退回默认值，而不是让它在 `isQuizFile`
 * 或解析器里抛异常、把整个插件卡死。
 */

import {
	DEFAULT_BLANK_MARKER,
	DEFAULT_BLOCK_LANGUAGE,
	DEFAULT_HEADING_LEVELS,
	DEFAULT_HEADING_MODE,
	HeadingMode,
} from "./parser";
import { DEFAULT_HISTORY_LIMIT } from "./writeback";
import { BlankMarkerMode } from "./types";
import { LanguagePreference, LANGUAGE_PREFERENCES } from "./i18n";

export interface RuntimeSettings {
	/** 界面语言：`auto` 跟随 Obsidian，其余为强制指定。 */
	language: LanguagePreference;
	blockLanguage: string;
	headingLevels: [number, number];
	/** 题面标题的匹配方式：固定层级，或自动取「自己这一段里有数据块」的最近标题。 */
	headingMode: HeadingMode;
	/** 空位标记样式：`==高亮==` / `**加粗**` / 两者都识别。 */
	blankMarker: BlankMarkerMode;
	pathGlobs: string[];
	historyLimit: number;
	writeBackEnabled: boolean;
	/** 是否在题卡上显示「题面已变更」提示。关掉后连"关闭提示"入口一起隐藏。 */
	showStaleHint: boolean;
}

export const DEFAULT_SETTINGS: RuntimeSettings = {
	language: "auto",
	blockLanguage: DEFAULT_BLOCK_LANGUAGE,
	headingLevels: DEFAULT_HEADING_LEVELS,
	headingMode: DEFAULT_HEADING_MODE,
	blankMarker: DEFAULT_BLANK_MARKER,
	pathGlobs: [],
	historyLimit: DEFAULT_HISTORY_LIMIT,
	writeBackEnabled: true,
	showStaleHint: true,
};

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
	return value as Record<string, unknown>;
}

function readBoolean(data: Record<string, unknown>, key: string, fallback: boolean): boolean {
	const value = data[key];
	return typeof value === "boolean" ? value : fallback;
}

function readHeadingLevels(value: unknown): [number, number] {
	if (
		Array.isArray(value) &&
		value.length === 2 &&
		value.every((item) => typeof item === "number" && Number.isInteger(item) && item >= 1 && item <= 6)
	) {
		return [value[0] as number, value[1] as number];
	}
	return [DEFAULT_HEADING_LEVELS[0], DEFAULT_HEADING_LEVELS[1]];
}

function readHeadingMode(value: unknown): HeadingMode {
	return value === "level" || value === "auto" ? value : DEFAULT_SETTINGS.headingMode;
}

function readBlankMarker(value: unknown): BlankMarkerMode {
	return value === "highlight" || value === "bold" || value === "both"
		? value
		: DEFAULT_SETTINGS.blankMarker;
}

function readBlockLanguage(value: unknown): string {
	if (typeof value !== "string") return DEFAULT_SETTINGS.blockLanguage;
	const trimmed = value.trim();
	return trimmed === "" ? DEFAULT_SETTINGS.blockLanguage : trimmed;
}

function readPathGlobs(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const globs: string[] = [];
	for (const item of value) {
		if (typeof item !== "string") continue;
		const trimmed = item.trim();
		if (trimmed !== "") globs.push(trimmed);
	}
	return globs;
}

function readHistoryLimit(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return DEFAULT_SETTINGS.historyLimit;
	return Math.trunc(value);
}

/**
 * 把 `loadData()` 读到的任意值收敛成 {@link RuntimeSettings}。
 *
 * 未知字段一律忽略；类型不对的字段退回默认值。这是插件与手写 `data.json`
 * 之间唯一的信任边界。
 */
export function sanitizeSettings(raw: unknown): RuntimeSettings {
	const data = asRecord(raw);
	const language = LANGUAGE_PREFERENCES.includes(data["language"] as LanguagePreference)
		? (data["language"] as LanguagePreference)
		: DEFAULT_SETTINGS.language;
	return {
		language,
		blockLanguage: readBlockLanguage(data["blockLanguage"]),
		headingLevels: readHeadingLevels(data["headingLevels"]),
		headingMode: readHeadingMode(data["headingMode"]),
		blankMarker: readBlankMarker(data["blankMarker"]),
		pathGlobs: readPathGlobs(data["pathGlobs"]),
		historyLimit: readHistoryLimit(data["historyLimit"]),
		writeBackEnabled: readBoolean(data, "writeBackEnabled", DEFAULT_SETTINGS.writeBackEnabled),
		showStaleHint: readBoolean(data, "showStaleHint", DEFAULT_SETTINGS.showStaleHint),
	};
}

/**
 * 与解析结果有关的设置指纹。
 *
 * 只有这些字段变化时才需要让刷题窗口与已渲染的题卡失效；改语言或写回开关
 * 不应打断进行中的一轮。`blockLanguage` 不在这里：代码块处理器只在加载时
 * 注册一次，设置页也明确要求改完重启 Obsidian，因此它不能靠重渲染生效。
 */
export function parseSettingsSignature(settings: RuntimeSettings): string {
	return JSON.stringify([
		settings.headingLevels,
		settings.headingMode,
		settings.blankMarker,
		settings.pathGlobs,
	]);
}
