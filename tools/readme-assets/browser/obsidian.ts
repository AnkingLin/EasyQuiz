/**
 * 浏览器里的 obsidian 存根（生成 README 截图用）。
 *
 * 由 esbuild 的 alias 把 `obsidian` 指到这里。只实现生成截图走过的那些 API，
 * 而且尽量"真"：
 *   - `MarkdownRenderer.render` 真的把 Markdown 变成 HTML（见 markdown.ts），
 *     否则题面会是一片空白；
 *   - `setIcon` 真的插入 SVG，否则降级题卡上只有一个空标签。
 *
 * 这里不实现任何 vault / 文件系统——那部分由 `scenes.ts` 直接喂给视图。
 */

import { renderMarkdown } from "../markdown";

/**
 * YAML 解析：真实 Obsidian 导出 `parseYaml`。
 *
 * `runtime.ts` 在模块顶层就引用它（组装 `parserDeps`），因此这里必须存在，
 * 哪怕截图流程自己注入的是 js-yaml。见 `scenes.ts` 里的 `DEPS`。
 */
export function parseYaml(_source: string): unknown {
	throw new Error("截图流程请显式注入 parseYaml（见 scenes.ts 的 DEPS）");
}

/**
 * Obsidian 图标集里这几个图标的路径数据（只取用得到的）。
 *
 * 存成路径数组而不是一整段 SVG 字符串：这样可以用 `createElementNS` 逐个建节点，
 * 不需要往 `innerHTML` 里塞标记。
 */
const ICONS: Record<string, readonly string[]> = {
	"alert-triangle": ["M12 3 L22 20 H2 Z", "M12 9 v6", "M12 18 h.01"],
	"graduation-cap": ["M2 8 12 4 22 8 12 12 Z", "M6 10 v5 c0 1 3 2 6 2 s6-1 6-2 v-5"],
};

export function setIcon(el: HTMLElement, name: string): void {
	const doc = el.ownerDocument;
	const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
	svg.setAttribute("viewBox", "0 0 24 24");
	svg.setAttribute("width", "16");
	svg.setAttribute("height", "16");
	svg.setAttribute("fill", "none");
	svg.setAttribute("stroke", "currentColor");
	svg.setAttribute("stroke-width", "2");
	for (const d of ICONS[name] ?? []) {
		const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
		path.setAttribute("d", d);
		svg.appendChild(path);
	}
	el.appendChild(svg);
}

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
	static render(
		_app: unknown,
		source: string,
		el: HTMLElement,
		_path: string,
		_component: unknown
	): Promise<void> {
		// 用 DOMParser 把 Markdown 渲染结果解析成节点再挂上去，而不是赋 `innerHTML`：
		// 既不触发不安全赋值规则，也顺带过滤掉解析器可能漏掉的意外结构。
		const parsed = new DOMParser().parseFromString(renderMarkdown(source), "text/html");
		el.replaceChildren(...Array.from(parsed.body.childNodes));
		return Promise.resolve();
	}
}

/** 视图只用到 path / basename / stat.mtime。 */
export class TFile {
	path = "";
	basename = "";
	stat = { mtime: 0 };
}

export class Notice {
	constructor(public message?: string) {}
}

export class Events {}
export class WorkspaceLeaf {}
export class Plugin {}
export class PluginSettingTab {}
export class MarkdownView {}
export class App {}

// 与真实 Obsidian 一致：View 是 Component，题卡渲染时创建的 MarkdownRenderChild
// 会挂到窗口上（`this.addChild`）。
export class View extends Component {
	app: unknown = {};
	containerEl: HTMLElement;
	constructor() {
		super();
		this.containerEl = document.body.createDiv();
	}
}

export class ItemView extends View {
	leaf: unknown;
	contentEl: HTMLElement;
	constructor(leaf?: unknown) {
		super();
		this.leaf = leaf;
		this.contentEl = document.body.createDiv();
	}
	addAction(): HTMLElement {
		return this.contentEl.createDiv();
	}
	getViewType(): string {
		return "";
	}
	getDisplayText(): string {
		return "";
	}
	getIcon(): string {
		return "";
	}
}

export class Modal {
	contentEl: HTMLElement;
	titleEl: HTMLElement;
	containerEl: HTMLElement;
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

export function debounce<T extends (...args: never[]) => unknown>(fn: T): T {
	return fn;
}

// ---------------------------------------------------------------------------
// Setting / 控件
// ---------------------------------------------------------------------------

interface TextComponentLike {
	onChange(callback: (value: string) => unknown): unknown;
}
interface ToggleComponentLike {
	onChange(callback: (value: boolean) => unknown): unknown;
}

export class Setting {
	settingEl: HTMLElement;
	infoEl: HTMLElement;
	nameEl: HTMLElement;
	descEl: HTMLElement;
	controlEl: HTMLElement;
	components: (TextComponentLike | ToggleComponentLike | ButtonComponent)[] = [];

	constructor(public containerEl: HTMLElement) {
		this.settingEl = containerEl.createDiv({ cls: "setting-item" });
		this.infoEl = this.settingEl.createDiv({ cls: "setting-item-info" });
		this.nameEl = this.infoEl.createDiv({ cls: "setting-item-name" });
		this.descEl = this.infoEl.createDiv({ cls: "setting-item-description" });
		this.controlEl = this.settingEl.createDiv({ cls: "setting-item-control" });
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
		const button = new ButtonComponent(this.controlEl);
		this.components.push(button);
		callback(button);
		return this;
	}
}

class TextComponent implements TextComponentLike {
	value = "";
	inputEl: HTMLInputElement;
	disabled = false;
	private handlers: ((value: string) => unknown)[] = [];

	constructor(container: HTMLElement) {
		this.inputEl = container.createEl("input");
		this.inputEl.type = "text";
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
		this.inputEl.disabled = disabled;
		return this;
	}
	setPlaceholder(placeholder: string): this {
		this.inputEl.placeholder = placeholder;
		return this;
	}
	setUserValue(value: string): void {
		this.value = value;
		for (const handler of this.handlers) handler(value);
	}
}

/** 下拉框：用原生 <select> 渲染，截图里才看得到「题型」这个控件。 */
class DropdownComponent extends TextComponent {
	private options = new Map<string, string>();
	private select: HTMLSelectElement;

	constructor(container: HTMLElement) {
		super(container);
		this.inputEl.remove();
		this.select = container.createEl("select");
		this.inputEl = this.select as unknown as HTMLInputElement;
	}

	addOption(value: string, display: string): this {
		this.options.set(value, display);
		const option = this.select.ownerDocument.createElement("option");
		option.value = value;
		option.textContent = display;
		this.select.appendChild(option);
		return this;
	}
	addOptions(record: Record<string, string>): this {
		for (const [value, display] of Object.entries(record)) this.addOption(value, display);
		return this;
	}
	getOptions(): string[] {
		return [...this.options.keys()];
	}
	setValue(value: string): this {
		this.value = value;
		this.select.value = value;
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.disabled = disabled;
		this.select.disabled = disabled;
		return this;
	}
}

class ToggleComponent {
	value = false;
	private handlers: ((value: boolean) => unknown)[] = [];
	private box: HTMLInputElement;

	constructor(container: HTMLElement) {
		this.box = container.createEl("input");
		this.box.type = "checkbox";
		this.box.addClass("checkbox-container");
	}

	setValue(value: boolean): this {
		this.value = value;
		this.box.checked = value;
		return this;
	}
	onChange(callback: (value: boolean) => unknown): this {
		this.handlers.push(callback);
		return this;
	}
	setUserValue(value: boolean): void {
		this.value = value;
		this.box.checked = value;
		for (const handler of this.handlers) handler(value);
	}
}

export class ButtonComponent {
	text = "";
	cta = false;
	private handlers: (() => unknown)[] = [];
	private button: HTMLButtonElement;

	constructor(container: HTMLElement) {
		this.button = container.createEl("button");
	}
	setButtonText(text: string): this {
		this.text = text;
		this.button.textContent = text;
		return this;
	}
	setCta(): this {
		this.cta = true;
		this.button.addClass("mod-cta");
		return this;
	}
	setDisabled(disabled: boolean): this {
		this.button.disabled = disabled;
		return this;
	}
	onClick(callback: () => unknown): this {
		this.handlers.push(callback);
		return this;
	}
	click(): void {
		for (const handler of this.handlers) handler();
	}
}
