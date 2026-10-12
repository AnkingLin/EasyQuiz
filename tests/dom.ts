/**
 * 轻量 DOM 测试环境。
 *
 * 用 jsdom 复现 Obsidian 在 DOM 原型上挂的那些辅助方法（`createDiv` / `addClass` / `empty` …），
 * 这样就能在 node 下调用真实的渲染与事件处理代码，而不是只测纯逻辑。
 */

import { JSDOM } from "jsdom";

type Prototype = {
	createEl?: unknown;
	createDiv?: unknown;
	createSpan?: unknown;
	createSvg?: unknown;
	empty?: unknown;
	addClass?: unknown;
	removeClass?: unknown;
	toggleClass?: unknown;
	setText?: unknown;
	appendText?: unknown;
};

let installed = false;

/** 安装 Obsidian 风格的 DOM 辅助方法，并返回 jsdom 的 window。 */
export function setupDom(): { window: Window & typeof window; document: Document } {
	const dom = new JSDOM("<!doctype html><html><body></body></html>", { pretendToBeVisual: true });
	const win = dom.window as unknown as Window & typeof window;

	installOn(win.HTMLElement.prototype, false);
	installOn(win.Element.prototype, true);

	// 让全局对象在测试里可用（view.ts 里用了 createEl/createSpan/createSvg、window、document）。
	// 注意：这里必须用 globalThis —— node 环境下原本没有 window，正是本函数要把它装上去。
	const globalAny = globalThis as unknown as Record<string, unknown>;
	globalAny["window"] = win;
	globalAny["document"] = win.document;
	globalAny["HTMLElement"] = win.HTMLElement;
	globalAny["Element"] = win.Element;
	globalAny["Node"] = win.Node;
	globalAny["ResizeObserver"] = class {
		observe(): void {}
		unobserve(): void {}
		disconnect(): void {}
	};
	// Obsidian 也提供全局的 createEl / createSpan / createSvg。
	// 注意：这些辅助方法需要 tag 的字面量类型，测试里 tag 是动态字符串，因此用构造签名绕过。
	type Helper = (tag: string, o?: { cls?: string; text?: string }) => Element;
	const body = win.document.body as unknown as {
		createEl: Helper;
		createSpan: (o?: { cls?: string; text?: string }) => Element;
		createDiv: (o?: { cls?: string; text?: string }) => Element;
		createSvg: Helper;
	};
	globalAny["createEl"] = (tag: string, o?: { cls?: string; text?: string }) => body.createEl(tag, o);
	globalAny["createSpan"] = (o?: { cls?: string; text?: string }) => body.createSpan(o);
	globalAny["createDiv"] = (o?: { cls?: string; text?: string }) => body.createDiv(o);
	globalAny["createSvg"] = (tag: string, o?: { cls?: string }) => body.createSvg(tag, o);
	// jsdom 没有布局，clientWidth/clientHeight 恒为 0；给一个非零值让绘制逻辑继续。
	Object.defineProperty(win.HTMLElement.prototype, "clientWidth", { get: () => 600, configurable: true });
	Object.defineProperty(win.HTMLElement.prototype, "clientHeight", { get: () => 400, configurable: true });
	Object.defineProperty(win.HTMLElement.prototype, "isConnected", { get: () => true, configurable: true });
	win.HTMLElement.prototype.getBoundingClientRect = () =>
		({ x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20, toJSON: () => ({}) });

	installed = true;
	void installed;
	return { window: win, document: win.document };
}

function installOn(proto: Prototype, svgToo: boolean): void {
	if (proto.createEl === undefined) {
		proto.createEl = function (this: Element, tag: string, o?: { cls?: string; text?: string }) {
			const el = this.ownerDocument.createElement(tag);
			if (o?.cls !== undefined) el.className = o.cls;
			if (o?.text !== undefined) el.textContent = o.text;
			this.appendChild(el);
			return el;
		};
	}
	if (proto.createDiv === undefined) {
		proto.createDiv = function (this: Element, o?: { cls?: string; text?: string }) {
			return (this as unknown as { createEl: (t: string, o?: unknown) => Element }).createEl("div", o);
		};
	}
	if (proto.createSpan === undefined) {
		proto.createSpan = function (this: Element, o?: { cls?: string; text?: string }) {
			return (this as unknown as { createEl: (t: string, o?: unknown) => Element }).createEl("span", o);
		};
	}
	if (svgToo && proto.createSvg === undefined) {
		proto.createSvg = function (this: Element, tag: string, o?: { cls?: string }) {
			const el = this.ownerDocument.createElementNS("http://www.w3.org/2000/svg", tag);
			if (o?.cls !== undefined) el.setAttribute("class", o.cls);
			this.appendChild(el);
			return el;
		};
	}
	if (proto.empty === undefined) {
		proto.empty = function (this: Element) {
			while (this.firstChild) this.removeChild(this.firstChild);
		};
	}
	if (proto.addClass === undefined) {
		proto.addClass = function (this: Element, ...classes: string[]) {
			for (const cls of classes) this.classList.add(cls);
		};
	}
	if (proto.removeClass === undefined) {
		proto.removeClass = function (this: Element, ...classes: string[]) {
			for (const cls of classes) this.classList.remove(cls);
		};
	}
	if (proto.toggleClass === undefined) {
		proto.toggleClass = function (this: Element, cls: string, value: boolean) {
			this.classList.toggle(cls, value);
		};
	}
	if (proto.setText === undefined) {
		proto.setText = function (this: Element, text: string) {
			this.textContent = text;
		};
	}
	if (proto.appendText === undefined) {
		proto.appendText = function (this: Element, text: string) {
			this.appendChild(this.ownerDocument.createTextNode(text));
		};
	}
}
