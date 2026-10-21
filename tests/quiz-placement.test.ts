/**
 * 刷题视图的打开位置判定。
 *
 * 三方入口都靠它决定"这个视图已经开在哪了"，进而复用而不是重复开窗：
 * 判断错了的后果很具体——会把侧边栏里的视图当成标签页（于是又开一个），
 * 或把弹出窗口里的视图当成主区域标签页（于是弹窗被抢走）。
 *
 * 判定只看两件事：容器归属于哪个 `document`、以及它的祖先里有没有边栏容器。
 * 前者区分弹出窗口，后者区分侧边栏与主区域标签页。
 */

import { setupDom } from "./dom";

setupDom();

import { placementOf } from "../src/practice-placement";
import { assert, assertEqual, test } from "./harness";

/** 造一棵最小的工作区骨架，返回指定位置的视图容器。 */
function container(where: "sidebar" | "tab" | "popout", mainDocument: Document): HTMLElement {
	const doc = where === "popout" ? mainDocument.implementation.createHTMLDocument("popout") : mainDocument;
	const body = doc.body;
	if (where === "sidebar") {
		// 左右边栏：叶子挂在带 mod-right-split 的容器里
		const split = doc.createElement("div");
		split.className = "workspace-split mod-vertical mod-right-split";
		const leaf = doc.createElement("div");
		leaf.className = "workspace-leaf";
		split.appendChild(leaf);
		body.appendChild(split);
		return leaf;
	}
	if (where === "tab") {
		const split = doc.createElement("div");
		split.className = "workspace-split mod-root";
		const leaf = doc.createElement("div");
		leaf.className = "workspace-leaf";
		split.appendChild(leaf);
		body.appendChild(split);
		return leaf;
	}
	const split = doc.createElement("div");
	split.className = "workspace-split mod-root";
	const leaf = doc.createElement("div");
	leaf.className = "workspace-leaf";
	split.appendChild(leaf);
	body.appendChild(split);
	return leaf;
}

test("位置：主区域的视图算标签页", () => {
	const main = document;
	assertEqual(placementOf(container("tab", main), main), "tab", "主区域里的叶子应是标签页");
});

test("位置：左右边栏的视图算侧边栏", () => {
	const main = document;
	assertEqual(placementOf(container("sidebar", main), main), "sidebar", "边栏里的叶子应是侧边栏");
});

test("位置：另一个文档里的视图算弹出窗口", () => {
	const main = document;
	assertEqual(placementOf(container("popout", main), main), "popout", "独立文档里的叶子应是弹出窗口");
});

test("位置：弹出窗口即使内部结构像主区域也不会被当成标签页", () => {
	const main = document;
	// 弹出窗口里的叶子同样挂在 .workspace-split.mod-root 下，只有 document 不同；
	// 先判 document 才不会把弹窗误认成主区域标签页。
	const leaf = container("popout", main);
	assert(leaf.ownerDocument !== main, "前提：弹窗容器属于另一个文档");
	assertEqual(placementOf(leaf, main), "popout", "文档归属优先于祖先类名");
});

test("位置：侧边栏容器里的嵌套视图仍算侧边栏", () => {
	const main = document;
	const outer = container("sidebar", main);
	const inner = main.createElement("div");
	outer.appendChild(inner);
	assertEqual(placementOf(inner, main), "sidebar", "深层嵌套不影响判定");
});
