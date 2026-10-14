/**
 * 把 Obsidian 挂在 DOM 原型上的辅助方法补到真实浏览器里。
 *
 * 与 `tests/dom.ts` 同一套逻辑，区别是不引入 jsdom——这里的 `window` 是浏览器
 * 自己的，因此有真实的排版引擎（配对题的连线必须靠真实布局才能画对）。
 */

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
	detach?: unknown;
};

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
	if (proto.detach === undefined) {
		proto.detach = function (this: Element) {
			this.remove();
		};
	}
}

/** 安装到位后返回 window，方便调用方直接用。 */
export function installObsidianDom(): Window {
	const win = window;
	installOn(win.HTMLElement.prototype, false);
	installOn(win.Element.prototype, true);

	// 全局的 createEl / createSpan / createSvg（Obsidian 也提供）。
	type Helper = (tag: string, o?: { cls?: string; text?: string }) => Element;
	const body = win.document.body as unknown as {
		createEl: Helper;
		createSpan: (o?: { cls?: string; text?: string }) => Element;
		createDiv: (o?: { cls?: string; text?: string }) => Element;
		createSvg: Helper;
	};
	const scope = globalThis as unknown as Record<string, unknown>;
	scope["createEl"] = (tag: string, o?: { cls?: string; text?: string }) => body.createEl(tag, o);
	scope["createSpan"] = (o?: { cls?: string; text?: string }) => body.createSpan(o);
	scope["createDiv"] = (o?: { cls?: string; text?: string }) => body.createDiv(o);
	scope["createSvg"] = (tag: string, o?: { cls?: string; text?: string }) => body.createSvg(tag, o);
	return win;
}
