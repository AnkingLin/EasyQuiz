/** 阅读视图重画时的滚动位置保持。 */

import { rerenderPreviewPreservingScroll } from "../src/preview-refresh";
import { assertEqual, test } from "./harness";

function fakeView(scroll: number): { calls: string[]; view: Parameters<typeof rerenderPreviewPreservingScroll>[0] } {
	const calls: string[] = [];
	return {
		calls,
		view: {
			previewMode: {
				getScroll: () => scroll,
				rerender: (full?: boolean) => calls.push(`rerender:${String(full)}`),
				applyScroll: (value: number) => calls.push(`scroll:${value}`),
			},
		},
	};
}

test("重画阅读视图：先取滚动位置，重画后恢复", () => {
	const { calls, view } = fakeView(420);
	rerenderPreviewPreservingScroll(view);
	assertEqual(calls.join(","), "rerender:true,scroll:420", "应先重画再恢复滚动");
});

test("重画阅读视图：局部重画同样保持滚动", () => {
	const { calls, view } = fakeView(12);
	rerenderPreviewPreservingScroll(view, false);
	assertEqual(calls.join(","), "rerender:false,scroll:12", "full 参数应透传");
});

test("重画阅读视图：取滚动位置失败时仍完成重画", () => {
	const calls: string[] = [];
	rerenderPreviewPreservingScroll({
		previewMode: {
			getScroll: () => {
				throw new Error("not laid out");
			},
			rerender: () => calls.push("rerender"),
			applyScroll: (value: number) => calls.push(`scroll:${value}`),
		},
	});
	assertEqual(calls.join(","), "rerender,scroll:0", "失败时应回到顶部而不是中断刷新");
});
