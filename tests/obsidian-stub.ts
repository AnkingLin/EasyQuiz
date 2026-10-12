/**
 * 测试用的 obsidian 存根。
 *
 * `obsidian` 包只有类型定义，没有运行时实现，因此 node 下无法直接引入。
 * 测试只用得到纯逻辑与 DOM 渲染，因此这里给出最小实现。
 */

export function parseYaml(source: string): unknown {
	throw new Error("测试中请显式注入 parseYaml");
}

export function setIcon(): void {
	// 图标在测试中不需要真实渲染。
}

export class MarkdownRenderer {
	static render(): Promise<void> {
		return Promise.resolve();
	}
}

export class TFile {
	path = "";
}

export class Plugin {}
export class PluginSettingTab {}
export class Setting {}
export class Notice {}
export class MarkdownView {}
export function debounce<T extends (...args: never[]) => unknown>(fn: T): T {
	return fn;
}
