/**
 * 测试用的 obsidian 存根。
 *
 * `obsidian` 包只有类型定义，没有运行时实现，因此 node 下无法直接引入。
 * 测试只用得到纯逻辑与 DOM 渲染，因此这里给出最小实现。
 */

export function parseYaml(source: string): unknown {
	throw new Error("测试中请显式注入 parseYaml");
}

/**
 * 语言探测的替身：插件用 `moment.locale()` 判断用户语言（1.4 起可用），
 * 测试的断言文案是中文，因此这里报中文。
 */
export const moment = {
	locale: (): string => "zh",
};

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
	basename = "";
	/** 真实 Obsidian 由路径派生；这里默认按 Markdown 笔记给，测试可显式改写。 */
	extension = "md";
	stat = { mtime: 0 };
}
export class Plugin {}
export class PluginSettingTab {}
export class Notice {}
export class MarkdownView {}
export class Events {}

/**
 * 菜单里的一个条目：只保留视图会用到的那几件事。
 *
 * 真实 Obsidian 的标题会渲染成 DOM，测试里只存在对象上——因此断言"菜单里有没有这一项"
 * 读的是 `title`，而不是去查文档。
 */
export class MenuItem {
	title = "";
	icon: string | null = null;
	private handlers: (() => unknown)[] = [];

	setTitle(title: string): this {
		this.title = title;
		return this;
	}
	setIcon(icon: string | null): this {
		this.icon = icon;
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

/** 菜单：`addItem` 的回调立即执行，条目按加入顺序保存。 */
export class Menu {
	items: MenuItem[] = [];

	addItem(callback: (item: MenuItem) => unknown): this {
		const item = new MenuItem();
		callback(item);
		this.items.push(item);
		return this;
	}

	/** 按标题取条目（测试用）。 */
	find(title: string): MenuItem | undefined {
		return this.items.find((item) => item.title === title);
	}
}

/** 事件引用：测试里只需要"注册过"这个事实。 */
export interface EventRef {
	kind: string;
}

/**
 * 工作区替身：只实现视图与菜单注册用到的部分。
 *
 * `on()` 会把监听器留下来，测试因此可以主动触发事件，观察菜单被加了什么。
 */
export class Workspace {
	private listeners = new Map<string, ((...args: never[]) => unknown)[]>();

	on(name: string, callback: (...args: never[]) => unknown): EventRef {
		const list = this.listeners.get(name) ?? [];
		list.push(callback);
		this.listeners.set(name, list);
		return { kind: name };
	}

	/** 触发某个事件（测试用）。 */
	emit(name: string, ...args: unknown[]): void {
		for (const listener of this.listeners.get(name) ?? []) {
			(listener as unknown as (...a: unknown[]) => unknown)(...args);
		}
	}

	/** 某个事件上挂了多少个监听器。 */
	listenerCount(name: string): number {
		return (this.listeners.get(name) ?? []).length;
	}
}
export class WorkspaceLeaf {}
export class View {
	app: unknown = {};
	containerEl: HTMLElement;
	constructor() {
		this.containerEl = document.body.createDiv();
	}
}
export class ItemView extends View {
	leaf: unknown;
	contentEl: HTMLElement;
	constructor(leaf: unknown) {
		super();
		this.leaf = leaf;
		this.contentEl = document.body.createDiv();
	}
	addAction(): HTMLElement {
		return this.contentEl.createDiv();
	}
}
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

/** 开关控件的回调签名与文本控件不同，因此单独给一个接口。 */
interface ToggleComponentLike {
	onChange(callback: (value: boolean) => unknown): unknown;
}

export class Setting {
	/** 设置行的名称区与控件区（与真实实现同名，视图会把控件挂进 controlEl）。 */
	settingEl: HTMLElement;
	/** 名称与说明的包裹层（真实 Obsidian 里叫 setting-item-info）。 */
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	/** 最近一次注册的控件，供测试读取值。 */
	components: (TextComponentLike | ToggleComponentLike | ButtonComponent)[] = [];

	constructor(public containerEl: HTMLElement) {
		// 结构与类名都对齐真实 Obsidian：样式表里针对 .setting-item-* 的规则
		// （尤其是窄屏下的上下排列）才能在测试与预览里真实生效。
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
		this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
		// 测试要按顺序取回某个 Setting 上的控件；给元素挂一个反向引用最省事。
		(this.settingEl as unknown as { setting: Setting }).setting = this;
	}

	setName(name: string): this {
		this.nameEl.textContent = name;
		return this;
	}
	setDesc(desc: string): this {
		this.descEl.textContent = desc;
		return this;
	}

	private track<T>(component: T): T {
		this.components.push(component as TextComponentLike | ToggleComponentLike | ButtonComponent);
		return component;
	}

	addText(callback: (text: TextComponent) => unknown): this {
		callback(this.track(new TextComponent(this.controlEl)));
		return this;
	}
	addDropdown(callback: (dropdown: DropdownComponent) => unknown): this {
		callback(this.track(new DropdownComponent(this.controlEl)));
		return this;
	}
	addToggle(callback: (toggle: ToggleComponent) => unknown): this {
		callback(this.track(new ToggleComponent(this.controlEl)));
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
	/** 对应的真实 input；测试可以直接改值并派发 change。 */
	inputEl: HTMLInputElement;
	disabled = false;
	private handlers: ((value: string) => unknown)[] = [];

	constructor(container: HTMLElement) {
		this.inputEl = container.createEl("input");
	}

	setValue(value: string): this {
		this.value = value;
		this.inputEl.value = value;
		return this;
	}
	onChange(callback: (value: string) => unknown): this {
		this.handlers.push(callback);
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
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

/** 开关控件：只保留"值 + 变化回调"这两件视图会用到的事。 */
class ToggleComponent {
	value = false;
	private handlers: ((value: boolean) => unknown)[] = [];

	constructor(public containerEl: HTMLElement) {}

	setValue(value: boolean): this {
		this.value = value;
		return this;
	}
	onChange(callback: (value: boolean) => unknown): this {
		this.handlers.push(callback);
		return this;
	}
	/** 模拟用户切换。 */
	setUserValue(value: boolean): void {
		this.value = value;
		for (const handler of this.handlers) handler(value);
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

