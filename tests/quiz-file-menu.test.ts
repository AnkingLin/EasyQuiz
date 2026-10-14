/**
 * 文件浏览器「更多选项」菜单里的题库入口。
 *
 * 这里不碰真实的 Obsidian 菜单（那是渲染层的事），只验证两件容易出错的事：
 *   1. **放行条件**：只有"恰好一个 Markdown 题库文件"才加这一项——多选、非 Markdown、
 *      非题库、文件夹都必须什么都不加，否则菜单里会出现一个点了没反应的假入口；
 *   2. **点下去真的到了那个题库**：菜单只负责转发路径，跳转由窗口自己完成。
 */

import { setupDom } from "./dom";

setupDom();

import { addPracticeItem, FileMenuHost, registerFileMenu } from "../src/file-menu";
import { t } from "../src/i18n";
import { Menu, TFile, Workspace } from "./obsidian-stub";
import { assertEqual, must, test } from "./harness";

/** 一个"是题库"的判定器：只有 `banks/` 下的文件算题库。 */
const service = {
	isQuizFile: (file: TFile) => file.path.startsWith("banks/"),
};

/** 造一个假的 TFile：路径与扩展名由参数决定。 */
function file(path: string, extension = "md"): TFile {
	const stub = new TFile();
	stub.path = path;
	stub.basename = (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
	stub.extension = extension;
	return stub;
}

/** 菜单 + 跳转记录。 */
interface Harness {
	menu: Menu;
	/** `openPracticeFor` 收到的路径。 */
	opened: string[];
	host: FileMenuHost;
}

function harness(): Harness {
	const opened: string[] = [];
	return {
		menu: new Menu(),
		opened,
		host: {
			service,
			openPracticeFor: (path: string) => {
				opened.push(path);
			},
		},
	};
}

/**
 * 把测试替身菜单交给 `addPracticeItem`。
 *
 * 替身只实现了真实 `Menu` 的一小部分，因此这里显式收窄类型：断言关心的是
 * "菜单里被加了什么"，不是替身与真实 API 的完整兼容。
 */
function addTo(menu: Menu, files: readonly TFile[], host: FileMenuHost): void {
	addPracticeItem(menu as never, files as never, host);
}

// ---------------------------------------------------------------------------
// 放行条件
// ---------------------------------------------------------------------------

test("文件菜单：题库文件会多出「刷这个题库」，点它跳到该文件", () => {
	const { menu, opened, host } = harness();
	addTo(menu, [file("banks/net.md")], host);

	assertEqual(menu.items.length, 1, "题库文件应多出一项");
	const item = must(menu.items[0], "缺菜单项");
	assertEqual(item.title, t("fileMenu.practice"), "菜单文案");
	item.click();
	assertEqual(opened.join(","), "banks/net.md", "点下去应跳到这个题库");
});

test("文件菜单：非题库文件不加这一项", () => {
	const { menu, host } = harness();
	addTo(menu, [file("notes/random.md")], host);
	assertEqual(menu.items.length, 0, "不是题库就不该出现这一项");
});

test("文件菜单：非 Markdown 文件（画布、PDF）不加这一项", () => {
	const { menu, host } = harness();
	addTo(menu, [file("banks/net.canvas", "canvas")], host);
	addTo(menu, [file("banks/net.pdf", "pdf")], host);
	assertEqual(menu.items.length, 0, "只有 Markdown 笔记可能是题库");
});

test("文件菜单：多选文件时不加这一项", () => {
	const { menu, host } = harness();
	// 两个文件即使都是题库也不该出现：这一项没法表达"刷哪几个"。
	addTo(menu, [file("banks/net.md"), file("banks/os.md")], host);
	assertEqual(menu.items.length, 0, "多选时不应加这一项");
});

test("文件菜单：菜单里加的是文件夹时不加这一项", () => {
	const { menu, host } = harness();
	// 文件夹在真实 Obsidian 里是 TFolder，不是 TFile。
	addPracticeItem(menu as never, [{ path: "banks", name: "banks" } as never], host);
	assertEqual(menu.items.length, 0, "文件夹不该出现刷题入口");
});

test("文件菜单：菜单项带图标，便于在长菜单里一眼认出", () => {
	const { menu, host } = harness();
	addTo(menu, [file("banks/net.md")], host);
	assertEqual(must(menu.items[0], "缺菜单项").icon, "graduation-cap", "应与丝带图标一致");
});

// ---------------------------------------------------------------------------
// 事件订阅
// ---------------------------------------------------------------------------

test("文件菜单：注册后 file-menu 与 files-menu 都会挂上监听器", () => {
	const workspace = new Workspace();
	const { host } = harness();
	const refs: unknown[] = [];
	registerFileMenu(workspace as never, host, (ref) => refs.push(ref));

	assertEqual(workspace.listenerCount("file-menu"), 1, "应订阅 file-menu");
	assertEqual(workspace.listenerCount("files-menu"), 1, "应订阅 files-menu");
	assertEqual(refs.length, 2, "两个监听器都应交给调用方清理（插件卸载时一起摘掉）");
});

test("文件菜单：file-menu 事件带着题库文件时会加这一项", () => {
	const workspace = new Workspace();
	const { opened, host } = harness();
	registerFileMenu(workspace as never, host, () => undefined);

	const menu = new Menu();
	workspace.emit("file-menu", menu, file("banks/net.md"));
	assertEqual(menu.items.length, 1, "事件应触发加项");
	must(menu.items[0], "缺菜单项").click();
	assertEqual(opened.join(","), "banks/net.md", "点下去应跳到该文件");
});

test("文件菜单：files-menu 事件在多选时什么都不加", () => {
	const workspace = new Workspace();
	const { host } = harness();
	registerFileMenu(workspace as never, host, () => undefined);

	const menu = new Menu();
	workspace.emit("files-menu", menu, [file("banks/net.md"), file("banks/os.md")]);
	assertEqual(menu.items.length, 0, "多选不该出现这一项");
});

test("文件菜单：菜单文案跟着界面语言走", () => {
	const { menu, host } = harness();
	addTo(menu, [file("banks/net.md")], host);
	// 断言用的是 t()，因此这条规则在中英两种语言下都成立：
	// 菜单文案必须与文案表一致，不能手写一份字符串。
	assertEqual(must(menu.items[0], "缺菜单项").title, t("fileMenu.practice"), "菜单文案应来自文案表");
});
