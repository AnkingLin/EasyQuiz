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
export class Notice {}
export class MarkdownView {}
export function debounce<T extends (...args: never[]) => unknown>(fn: T): T {
	return fn;
}

// ---------------------------------------------------------------------------
// 对话框相关的最小实现
//
// 只覆盖测试用得到的部分：真实 Obsidian 会负责窗口布局、样式与焦点，
// 这里只要能挂载元素、触发按钮回调即可。`textComponent()` 在测试里不会被调用。
// ---------------------------------------------------------------------------

/** 容器上的 `createDiv` / `createEl` 由 tests/dom.ts 装在 Element 原型上。 */
export class Modal {
	contentEl: HTMLElement;
	titleEl: HTMLElement;
	containerEl: HTMLElement;
	/** 是否已打开，测试用它断言 open() / close() 的配对。 */
	isOpen = false;

	constructor(public app: unknown) {
		this.containerEl = document.body.createDiv();
		this.titleEl = this.containerEl.createDiv();
		this.contentEl = this.containerEl.createDiv();
	}

	open(): void {
		this.isOpen = true;
		this.onOpen();
	}

	close(): void {
		this.isOpen = false;
		this.onClose();
		this.containerEl.detach();
	}

	onOpen(): void {}
	onClose(): void {}
}

interface TextComponentLike {
	onChange(callback: (value: string) => unknown): unknown;
}

export class Setting {
	/** 测试里用它调用 `.addText()` 等回调，观察控件状态。 */
	settingEl: HTMLElement;
	/** 最近一次注册的控件，供测试读取值。 */
	components: (TextComponentLike | ButtonComponent)[] = [];

	constructor(public containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv();
		// 测试要按顺序取回某个 Setting 上的控件；给元素挂一个反向引用最省事。
		(this.settingEl as unknown as { setting: Setting }).setting = this;
	}

	setName(_name: string): this {
		return this;
	}
	setDesc(_desc: string): this {
		return this;
	}

	private track<T extends TextComponentLike>(component: T): T {
		this.components.push(component);
		return component;
	}

	addText(callback: (text: TextComponent) => unknown): this {
		callback(this.track(new TextComponent()));
		return this;
	}
	addDropdown(callback: (dropdown: DropdownComponent) => unknown): this {
		callback(this.track(new DropdownComponent()));
		return this;
	}
	addButton(callback: (button: ButtonComponent) => unknown): this {
		const button = new ButtonComponent();
		this.components.push(button);
		callback(button);
		return this;
	}
}

class TextComponent implements TextComponentLike {
	value = "";
	private handlers: ((value: string) => unknown)[] = [];

	setValue(value: string): this {
		this.value = value;
		return this;
	}
	onChange(callback: (value: string) => unknown): this {
		this.handlers.push(callback);
		return this;
	}
	/** 模拟用户输入。 */
	setUserValue(value: string): void {
		this.value = value;
		for (const handler of this.handlers) handler(value);
	}
}

class DropdownComponent extends TextComponent {
	private options = new Map<string, string>();

	addOption(value: string, display: string): this {
		this.options.set(value, display);
		return this;
	}
	getOptions(): string[] {
		return [...this.options.keys()];
	}
}

/** 与真实 ButtonComponent 同名的测试替身；实现放在 tests/obsidian-stub.ts 内部使用。 */
export class ButtonComponent {
	text = "";
	cta = false;
	private handlers: (() => unknown)[] = [];

	setButtonText(text: string): this {
		this.text = text;
		return this;
	}
	setCta(): this {
		this.cta = true;
		return this;
	}
	onClick(callback: () => unknown): this {
		this.handlers.push(callback);
		return this;
	}
	/** 模拟点击。 */
	click(): void {
		for (const handler of this.handlers) handler();
	}
}

