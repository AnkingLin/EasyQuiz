/**
 * 语言适配（纯逻辑，不依赖 obsidian）。
 *
 * 设计要点：
 *   - 文案表按语言放在 `en.ts` / `zh.ts`，键必须一一对应（`zh` 的类型是
 *     `Record<MessageKey, string>`，漏译会在 `tsc` 阶段暴露）。
 *   - 语言只在 `setLanguage()` 里变一次；渲染层每次调用 `t()` 取当前语言的文案，
 *     因此切换语言后只要重画界面就会生效，不需要重新加载插件。
 *   - 纯逻辑模块（parser / grade / session …）也直接调用 `t()`，所以这个文件
 *     不能 import obsidian，否则那些模块就没法在 node 下跑了。
 */

import { en, MessageKey } from "./en";
import { zh } from "./zh";

export type { MessageKey, MessageTable } from "./en";

/** 支持的语言。 */
export type Language = "en" | "zh";

/** 设置里的语言选项：`auto` 表示跟随 Obsidian。 */
export type LanguagePreference = Language | "auto";

export const LANGUAGES: readonly Language[] = ["en", "zh"];

/** 设置项可选项的顺序（`auto` 由调用方追加或用它自己的键）。 */
export const LANGUAGE_PREFERENCES: readonly LanguagePreference[] = ["auto", "en", "zh"];

const TABLES: Record<Language, Record<MessageKey, string>> = { en, zh };

/**
 * 兜底语言：只有当调用方完全拿不到 Obsidian 的语言信息时才会用到它。
 * 英文是基准语言，所以缺省也用它。
 */
const FALLBACK_LANGUAGE: Language = "en";

let current: Language = FALLBACK_LANGUAGE;

/** 把任意语言标识收敛成支持的语言：`zh-cn` / `zh-Hant` 之类都算中文。 */
export function normalizeLanguage(tag: string | null | undefined): Language | null {
	if (typeof tag !== "string") return null;
	const lower = tag.trim().toLowerCase();
	if (lower === "") return null;
	if (lower === "zh" || lower.startsWith("zh-") || lower.startsWith("zh_")) return "zh";
	if (lower === "en" || lower.startsWith("en-") || lower.startsWith("en_")) return "en";
	return null;
}

/**
 * 按优先级从若干语言来源里挑一个：第一个能识别的来源胜出。
 *
 * 来源按可信度排序（Obsidian 的语言设置 → 文档语言 → 浏览器语言），
 * 认不出来的来源会被跳过，因此调用方可以把拿得到的东西都传进来。
 */
export function detectLanguage(sources: readonly (string | null | undefined)[]): Language {
	for (const source of sources) {
		const language = normalizeLanguage(source ?? null);
		if (language !== null) return language;
	}
	return FALLBACK_LANGUAGE;
}

/** 结合设置里的偏好与探测到的语言，算出实际使用的语言。 */
export function resolveLanguage(
	preference: LanguagePreference,
	sources: readonly (string | null | undefined)[]
): Language {
	if (preference !== "auto") return preference;
	return detectLanguage(sources);
}

/** 当前语言。 */
export function getLanguage(): Language {
	return current;
}

/** 设置当前语言；返回是否发生了变化（调用方据此决定要不要重画界面）。 */
export function setLanguage(language: Language): boolean {
	if (language === current) return false;
	current = language;
	return true;
}

/**
 * 取一条文案。
 *
 * `params` 里的值替换 `{name}` 占位符；没有提供的占位符原样保留，
 * 这样漏传参数时用户看到的是 `{count}` 而不是 `undefined`，一眼能看出问题。
 */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
	const table = TABLES[current] ?? TABLES[FALLBACK_LANGUAGE];
	const template = table[key] ?? en[key] ?? key;
	if (params === undefined) return template;
	return template.replace(/\{(\w+)\}/g, (match, name: string) => {
		const value = params[name];
		return value === undefined ? match : String(value);
	});
}

/** 本语言下的枚举分隔符（中文用「、」，英文用「, 」）。 */
export function listSeparator(): string {
	return t("common.listSeparator");
}

/** 本语言下的分句分隔符（中文用「；」，英文用「; 」）。 */
export function clauseSeparator(): string {
	return t("common.clauseSeparator");
}
