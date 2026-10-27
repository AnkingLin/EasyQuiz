/**
 * 从题卡回到源笔记：标题链接的拼法、打开、以及把视图定位到题面那一行。
 *
 * 阅读视图里的题卡（数据块与 `题目id` 引用）和刷题窗口右上角的铅笔共用这一份
 * 逻辑。只靠标题链接并不够稳：标题末尾常带知识点链接 `^[[[笔记#小节]]]`，缓存里
 * 的标题原文与链接写法之间隔着一层归一化，链接一旦落空，Obsidian 会安静地把
 * 笔记打开在顶部。因此打开之后再按行号定位一次——行号来自解析结果本身，不依赖
 * 标题匹配，题面一定在可见范围内。
 */

import {
	App,
	MarkdownView,
	Notice,
	stripHeading,
	stripHeadingForLink,
	TFile,
} from "obsidian";
import { t } from "./i18n";
import { QuizQuestion } from "./types";

/**
 * 题面标题在链接里的写法。
 *
 * 优先取元数据缓存里同一行的原文（它带着知识点链接，由 `stripHeadingForLink`
 * 转成 Obsidian 生成标题链接时的写法）；行号对不上时按归一化后的标题兜底，
 * 仍然找不到才退回解析出来的标题文字。返回 null 表示这道题没有可用的标题。
 */
export function sourceHeading(app: App, file: TFile, question: QuizQuestion): string | null {
	const headings = app.metadataCache.getFileCache(file)?.headings ?? [];
	const cached =
		headings.find((item) => item.position.start.line === question.line)?.heading ??
		headings.find((item) => sameStemHeading(item.heading, question.title))?.heading;
	const heading = stripHeadingForLink(cached ?? question.title).trim();
	return heading === "" ? null : heading;
}

/**
 * 缓存的标题行号对不上时的兜底：两边都按 Obsidian 的 `stripHeading` 归一化后比较，
 * 并允许缓存标题在题面之后还带着 `^[[[知识点]]]`（归一化前它跟在题面后面）。
 */
function sameStemHeading(cached: string, title: string): boolean {
	const target = stripHeading(title).toLowerCase();
	if (target === "") return false;
	const candidate = stripHeading(cached).toLowerCase();
	return candidate === target || candidate.startsWith(`${target} `);
}

/** 打开题面所在的笔记，并把它定位到题面标题那一行。 */
export async function openQuestionSource(
	app: App,
	file: TFile,
	question: QuizQuestion | undefined
): Promise<void> {
	const heading = question === undefined ? null : sourceHeading(app, file, question);
	const link = heading === null ? file.path : `${file.path}#${heading}`;
	try {
		await app.workspace.openLinkText(link, file.path, false);
		if (question !== undefined) revealLine(app, file, question.line);
	} catch (error) {
		new Notice(
			t("practice.session.openNoteFailed", {
				error: error instanceof Error ? error.message : String(error),
			})
		);
	}
}

/**
 * 把已经打开的笔记定位到某一行。
 *
 * `setEphemeralState({ line })` 是 Obsidian 自己的定位入口：阅读视图滚动到那一行
 * 并高亮，编辑模式滚动并把光标放上去。优先用当前活动的那个笔记视图，同一份笔记
 * 开了多个标签页时不会定位到看不见的那一个。
 */
function revealLine(app: App, file: TFile, line: number): void {
	const leaves = app.workspace.getLeavesOfType?.("markdown") ?? [];
	const views = leaves
		.map((leaf) => leaf.view)
		.filter(
			(view): view is MarkdownView =>
				view instanceof MarkdownView && view.file?.path === file.path
		);
	if (views.length === 0) return;
	const last = views[views.length - 1];
	if (last === undefined) return;
	const active = app.workspace.getActiveViewOfType?.(MarkdownView) ?? null;
	const target = active !== null && views.includes(active) ? active : last;
	target.setEphemeralState({ line });
}
