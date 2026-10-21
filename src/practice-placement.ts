/**
 * 刷题视图开在哪里。
 *
 * 视图本身不关心自己被挂在哪——侧边栏、主区域标签页、独立窗口里都是同一份
 * `PracticeView`。需要区分位置的只有"打开"这层：同一个位置只留一个刷题视图，
 * 已经开着就地切回来，避免连点命令开出一堆窗口。
 *
 * 判定只能看 DOM：Obsidian 没有公开 API 能问"这个叶子在哪个容器里"，
 * 而 `leaf.parent` / `leaf.getRoot()` 属于内部结构。用文档归属 + 祖先类名
 * 这两件事判断，既够用也不依赖私有字段。
 */

/** 刷题视图可以开在哪里。 */
export type PracticePlacement = "sidebar" | "tab" | "popout";

/**
 * 左右边栏的叶子挂在这两个 split 容器里。
 * 移动端的侧边抽屉也带同一组标记，因此不用单独分支。
 */
const SIDEBAR_SELECTOR = ".mod-left-split, .mod-right-split";

/**
 * 视图容器现在挂在哪个位置。
 *
 * - `popout`：弹出窗口有独立的 `document`，先判它，否则弹窗里的叶子会被
 *   当成主区域标签页；
 * - `sidebar`：左右边栏；
 * - `tab`：主区域的标签页（含分屏）。
 */
export function placementOf(containerEl: HTMLElement, mainDocument: Document): PracticePlacement {
	if (containerEl.ownerDocument !== mainDocument) return "popout";
	return containerEl.closest(SIDEBAR_SELECTOR) === null ? "tab" : "sidebar";
}
