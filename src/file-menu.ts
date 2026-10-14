/**
 * 文件浏览器里的题库入口。
 *
 * Obsidian 会为文件（以及右键菜单、多选菜单）发出 `file-menu` / `files-menu` 事件，
 * 文件右侧的「更多选项」三个点菜单就是其中之一。这里把「刷这个题库」加进去，
 * 让用户在文件树里直接开始刷题，不必先打开刷题窗口再翻列表。
 *
 * 分工：本模块只判断"这是不是一个题库文件"，放行后由刷题窗口的 `openPickerFor`
 * 负责扫描、解析与跳转——识别规则仍然只有 `QuizService.isQuizFile` 一份。
 */

import { TFile } from "obsidian";
import type { EventRef, Menu, TAbstractFile, Workspace } from "obsidian";
import { t } from "./i18n";

/** 判定"这个文件是不是题库"的最小接口；`QuizService` 天然满足它。 */
export interface QuizFileGate {
	isQuizFile(file: TFile): boolean;
}

/** 宿主需要提供的东西：题库判定 + 打开刷题设置的动作。 */
export interface FileMenuHost {
	service: QuizFileGate;
	/** 打开刷题窗口并直接进入该题库的刷题设置页。 */
	openPracticeFor(path: string): void | Promise<void>;
}

/**
 * 订阅两个文件菜单事件。
 *
 * `register` 由插件传入（`this.registerEvent`），因此插件卸载时监听器一起摘掉。
 */
export function registerFileMenu(
	workspace: Workspace,
	host: FileMenuHost,
	register: (ref: EventRef) => void
): void {
	register(
		workspace.on("file-menu", (menu, file) => {
			addPracticeItem(menu, [file], host);
		})
	);
	// 多选时的菜单：只放行"选中的恰好是一个题库文件"。
	register(
		workspace.on("files-menu", (menu, files) => {
			addPracticeItem(menu, files, host);
		})
	);
}

/** 把「刷这个题库」加进菜单；选中的不是恰好一个题库文件时什么都不加。 */
export function addPracticeItem(menu: Menu, files: readonly TAbstractFile[], host: FileMenuHost): void {
	if (files.length !== 1) return;
	const file = files[0];
	if (!(file instanceof TFile)) return;
	// 只有 Markdown 笔记才可能是题库；画布、PDF 之类直接跳过。
	if (file.extension !== "md") return;
	if (!host.service.isQuizFile(file)) return;

	menu.addItem((item) =>
		item
			.setTitle(t("fileMenu.practice"))
			.setIcon("graduation-cap")
			.onClick(() => {
				void host.openPracticeFor(file.path);
			})
	);
}
