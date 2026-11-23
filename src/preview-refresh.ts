/**
 * 重画阅读视图并保持滚动位置（纯逻辑，不依赖 obsidian）。
 *
 * 阅读视图重渲染后默认会回到顶部。插件在文件修改、设置变更、手动刷新时
 * 主动重画题卡，若因此把读者弹回开头，体验比不刷新还差；这里在重画前后
 * 保存/恢复滚动位置，单元测试用一个最小的 PreviewViewLike 验证。
 */

/** 只依赖 MarkdownPreviewView 的三个公开方法，便于测试。 */
export interface PreviewViewLike {
	previewMode: {
		getScroll(): number;
		applyScroll(scroll: number): void;
		rerender(full?: boolean): void;
	};
}

/** 重画阅读视图；`full` 与 `MarkdownPreviewView.rerender` 的含义一致。 */
export function rerenderPreviewPreservingScroll(view: PreviewViewLike, full = true): void {
	let scroll = 0;
	try {
		scroll = view.previewMode.getScroll();
	} catch {
		// 视图还没完成布局时拿不到滚动位置：按顶部处理，至少完成重画。
		scroll = 0;
	}
	view.previewMode.rerender(full);
	try {
		view.previewMode.applyScroll(scroll);
	} catch {
		// 某些视图在重建期间不可滚动；重画本身已经生效，忽略恢复失败。
	}
}
