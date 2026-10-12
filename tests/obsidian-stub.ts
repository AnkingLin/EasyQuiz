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

/** 只用于满足 MarkdownRenderer.render 的 Component 参数。 */
export class Component {
	load(): void {}
	unload(): void {}
	onload(): void {}
	onunload(): void {}
	addChild<T>(child: T): T {
		return child;
	}
	removeChild<T>(child: T): T {
		return child;
	}
	register(_callback: () => void): void {}
	registerEvent(_event: unknown): void {}
	registerDomEvent(_el: unknown, _type: string, _callback: unknown): void {}
	registerInterval(_id: number): number {
		return 0;
	}
}

export class MarkdownRenderChild extends Component {
	containerEl: HTMLElement;
	constructor(containerEl: HTMLElement) {
		super();
		this.containerEl = containerEl;
	}
}

export class MarkdownRenderer {
	/** 记录 render 的调用参数，供测试断言 Component 一定被传入。 */
	static calls: { component: unknown }[] = [];

	static render(
		_app: unknown,
		_source: string,
		_el: HTMLElement,
		_path: string,
		component: unknown
	): Promise<void> {
		MarkdownRenderer.calls.push({ component });
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
