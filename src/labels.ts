/**
 * 题型文案（纯逻辑，不依赖 obsidian）。
 *
 * 题卡上的角标、插入对话框的下拉框、刷题窗口的题型筛选都读这里，因此三处的
 * 题型名永远一致；默认题干标题也放在这里，模板与对话框共用一份。
 *
 * 这些函数每次都从当前语言取文案（而不是模块加载时定死），所以切换语言后
 * 重画界面即可生效。
 */

import { t } from "./i18n";
import { QuizType } from "./types";

/** 题型显示名；`null`（题型缺失或非法）给出「未知」。 */
export function typeLabel(type: QuizType | null): string {
	if (type === null) return t("type.unknown");
	return typeLabels()[type] ?? t("type.unknown");
}

/** 全部题型的显示名。 */
export function typeLabels(): Record<QuizType, string> {
	return {
		single: t("type.single"),
		multi: t("type.multi"),
		match: t("type.match"),
		blank: t("type.blank"),
		essay: t("type.essay"),
	};
}

/** 各题型的默认题干标题，作为插入对话框输入框的初始值。 */
export function defaultTitles(): Record<QuizType, string> {
	return {
		single: t("insert.title.single"),
		multi: t("insert.title.multi"),
		match: t("insert.title.match"),
		blank: t("insert.title.blank"),
		essay: t("insert.title.essay"),
	};
}
