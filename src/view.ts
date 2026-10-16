/**
 * 刷题界面渲染：把一道题渲染成可交互的题卡。
 *
 * 设计约束（README §1.3）：实时预览下光标进入会把渲染结果还原为源码，
 * 因此刷题在阅读视图/预览中完成；题卡本身不写文件，提交时统一交给 QuizService。
 *
 * 渲染分工：题面只渲染"非交互部分"——选择题的选项列表、配对题的表格、
 * 填空题的 `==答案==` 由各自的交互控件承担，避免同一内容出现两次。
 */

import { App, Component, MarkdownRenderer, MarkdownRenderChild, setIcon, TFile } from "obsidian";
import { GradeResult, UserAnswer } from "./grade";
import { t } from "./i18n";
import { typeLabel } from "./labels";
import { createBoardState, splitConnection } from "./match-board";
import { plainText } from "./plain-text";
import { formatStats, QuizService, staleNote } from "./runtime";
import { BLANK_MARKER_PREFIX, formatStem } from "./stem";
import { BlankMarkerMode, QuizQuestion } from "./types";

export interface CardContext {
	app: App;
	service: QuizService;
	file: TFile;
	/** 题卡根容器。 */
	el: HTMLElement;
	/** 数据块所在行（用于把题卡与源码位置对应起来）。 */
	blockLine?: number;
	/** 空位标记样式，需与解析设置一致。 */
	blankMarker: BlankMarkerMode;
	/**
	 * 承载 MarkdownRenderer 生命周期的 Component。
	 * 不传时插件会自己创建一个 MarkdownRenderChild，并通过 `addRenderChild` 注册。
	 */
	renderComponent?: Component;
	/** 把自建的 MarkdownRenderChild 交给 Obsidian 的渲染上下文托管。 */
	addRenderChild?: (child: MarkdownRenderChild) => void;
	/** 提交完成后回调（用于刷新统计角标）。 */
	onSubmitted?: (result: GradeResult) => void;
	/**
	 * 复盘模式（刷题窗口用）：不挂提交按钮，改为直接显示正确答案与解析。
	 * 数据块渲染出的题卡不使用这个模式——那里的"看答案"就是重新读一遍源码。
	 */
	reviewOnly?: boolean;
	/** 复盘渲染完成后的回调，参数是这次作答的结果；提交页用它把卡片切到复盘视图。 */
	onReview?: (result: GradeResult | null) => void;
	/** 题卡渲染结束（含题板布局完成）后回调，用于解除观察者等自身资源。 */
	onCleanup?: (cleanup: () => void) => void;
}

/** 选择题的正确答案锚点列表（单选也会被收成数组）。 */
function answerAnchors(question: QuizQuestion): string[] {
	if (question.answer === null) return [];
	return Array.isArray(question.answer) ? question.answer : [question.answer];
}

/**
 * 渲染一道题。题目不可作答时渲染诊断卡片而不是刷题界面。
 */
export async function renderQuizCard(question: QuizQuestion, ctx: CardContext): Promise<void> {
	const card = ctx.el.createDiv({ cls: "easy-quiz-card" });
	if (!question.ok) {
		renderDiagnostics(question, card);
		return;
	}

	const header = card.createDiv({ cls: "easy-quiz-card__header" });
	header.createSpan({ cls: "easy-quiz-card__type", text: typeLabel(question.type) });
	header.createSpan({ cls: "easy-quiz-card__title", text: question.title });
	header.createSpan({
		cls: `easy-quiz-card__stats${question.stale ? " is-stale" : ""}`,
		text: formatStats(question),
	});
	renderKnowledgeLink(question, card, ctx);

	const stale = staleNote(question);
	if (stale) {
		card.createDiv({ cls: "easy-quiz-card__stale", text: stale });
	}

	const bodyEl = card.createDiv({ cls: "easy-quiz-card__body" });

	// Obsidian 要求传入承载生命周期的 Component：传 null 会直接抛错，
	// 并使这一道题后续的渲染（包括题板）全部中断。
	// 题面与选项都要渲染 Markdown，因此整张卡片共用一个，而不是各建一份。
	let component = ctx.renderComponent;
	if (component === undefined) {
		const child = new MarkdownRenderChild(card);
		ctx.addRenderChild?.(child);
		component = child;
	}

	const stem = formatStem(question, ctx.blankMarker);
	if (stem.trim() !== "") {
		await MarkdownRenderer.render(ctx.app, stem, bodyEl, ctx.file.path, component);
	}

	switch (question.type) {
		case "single":
		case "multi":
			await renderChoice(question, card, ctx, component);
			break;
		case "blank":
			renderBlanks(question, bodyEl, card, ctx);
			break;
		case "match":
			renderMatch(question, card, ctx);
			break;
		case "essay":
			renderEssay(question, card, ctx);
			break;
	}
}

// ---------------------------------------------------------------------------
// 知识点链接
// ---------------------------------------------------------------------------

/**
 * 渲染题面标题末尾 `^[[[知识点]]]` 对应的链接。
 *
 * 放在题卡头部而不是题面里：题面只回答"题目在问什么"，溯源信息属于卡片的元信息。
 * 点击走 Obsidian 自己的链接处理（`openLinkText`），因此 `#标题`、`|别名` 都按原样生效。
 */
function renderKnowledgeLink(question: QuizQuestion, card: HTMLElement, ctx: CardContext): void {
	const raw = question.knowledgeLink;
	if (raw === null) return;

	const { target, label, subpath } = splitWikiTarget(raw);
	if (label === "") return;
	const row = card.createDiv({ cls: "easy-quiz-card__knowledge" });
	row.createSpan({ cls: "easy-quiz-card__knowledge-label", text: t("card.knowledgePoint") });
	const link = row.createEl("a", {
		cls: "easy-quiz-card__knowledge-link",
		text: label,
		href: target,
	});
	// Obsidian 的 `metadataCache.fileToLinktext` 能解析短链接，但不是所有版本都导出它；
	// 拿不到就退回链接原文，至少不会跳错。
	link.onclick = (event) => {
		event.preventDefault();
		void openLinkText(ctx, raw, target, subpath);
	};
}

/**
 * 拆开一个 wikilink：`路径#小标题|别名` → 目标、显示文字、小标题。
 *
 * `#` 在开头时表示"本文件内的标题"（`[[#某标题]]`），此时目标文件为空，交给 Obsidian
 * 按当前文件解析。
 */
export function splitWikiTarget(raw: string): { target: string; label: string; subpath: string } {
	const pipe = raw.indexOf("|");
	const alias = pipe >= 0 ? raw.slice(pipe + 1) : null;
	const body = (pipe >= 0 ? raw.slice(0, pipe) : raw).trim();
	const hash = body.indexOf("#");
	const target = hash === -1 ? body : body.slice(0, hash).trim();
	const subpath = hash === -1 ? "" : body.slice(hash + 1).trim();
	return { target, label: alias === null || alias.trim() === "" ? body : alias.trim(), subpath };
}

/** 点击后打开知识点笔记；短链接交给 metadataCache 解析，失败时退回链接原文。 */
async function openLinkText(
	ctx: CardContext,
	raw: string,
	target: string,
	subpath: string
): Promise<void> {
	const workspace = ctx.app.workspace as { openLinkText?: (link: string, source: string, newLeaf?: boolean) => Promise<void> };
	if (typeof workspace?.openLinkText !== "function") return;

	let resolved = raw;
	if (target !== "") {
		const cache = ctx.app.metadataCache;
		const file = cache?.getFirstLinkpathDest?.(target, ctx.file.path) ?? null;
		if (file && typeof cache?.fileToLinktext === "function") {
			const linktext = cache.fileToLinktext(file, ctx.file.path, false);
			resolved = `${linktext}${subpath === "" ? "" : `#${subpath}`}`;
		}
	}
	await workspace.openLinkText(resolved, ctx.file.path, false);
}

// ---------------------------------------------------------------------------
// 诊断卡片（降级题）
// ---------------------------------------------------------------------------

function renderDiagnostics(question: QuizQuestion, card: HTMLElement): void {
	card.addClass("is-diagnostic");
	const header = card.createDiv({ cls: "easy-quiz-card__header" });
	const icon = header.createSpan({ cls: "easy-quiz-card__icon" });
	setIcon(icon, "alert-triangle");
	header.createSpan({ cls: "easy-quiz-card__title", text: question.title });
	card.createDiv({ cls: "easy-quiz-card__hint", text: t("card.diagnostic.hint") });
	const list = card.createEl("ul", { cls: "easy-quiz-card__warnings" });
	if (question.warnings.length === 0) {
		list.createEl("li", { text: t("card.diagnostic.incomplete") });
		return;
	}
	for (const warning of question.warnings) {
		const line = warning.line === null ? "" : t("card.diagnostic.line", { line: warning.line + 1 });
		list.createEl("li", { text: `${warning.message}${line}` });
	}
}

// ---------------------------------------------------------------------------
// 选择题
// ---------------------------------------------------------------------------

/**
 * 渲染选择题的选项。
 *
 * **选项按 Markdown 渲染**（`option.markdown`，已去掉锚点）。早期版本直接把
 * `option.text` 当纯文本塞进 `textContent`，而 `text` 是给匹配用的规范化结果
 * （`normalizeText` 会删掉 `*` `_` `` ` `` `~`），于是 `H~2~O` 显示成 `H2O`、
 * `~5%` 显示成 `5%`。选项是作者写的 Markdown，就该按 Markdown 渲染。
 * 行内渲染（`MarkdownRenderer.render`）不会破坏选项行的排版，也不会渲染
 * 多行块结构——选项本身是单行列表项。
 */
async function renderChoice(
	question: QuizQuestion,
	card: HTMLElement,
	ctx: CardContext,
	component: Component
): Promise<void> {
	const multi = question.type === "multi";
	const selected = new Set<string>();
	const list = card.createDiv({ cls: "easy-quiz-card__options" });
	const buttons: { anchor: string | null; el: HTMLElement }[] = [];

	const sync = () => {
		for (const button of buttons) {
			const isSelected = button.anchor !== null && selected.has(button.anchor);
			button.el.toggleClass("is-selected", isSelected);
			button.el.setAttribute("aria-checked", isSelected ? "true" : "false");
		}
	};

	// 复盘态：把正确选项标出来（提交后由 renderSubmit 统一驱动复盘）。
	const review = ctx.reviewOnly === true;

	for (const option of question.options) {
		// 用普通按钮而不是 <input type="radio">：避免表单控件在阅读视图里的原生行为
		// （重渲染、键盘默认动作）干扰数据块渲染。
		const row = list.createDiv({ cls: "easy-quiz-card__option" });
		row.setAttribute("role", multi ? "checkbox" : "radio");
		row.setAttribute("aria-checked", "false");
		row.tabIndex = 0;
		// 把锚点写到行上，外部工具（README 素材生成器、将来的自动化）即可按锚点定位选项，
		// 不必依赖"第几个渲染出来的选项"。
		if (option.anchor !== null) row.setAttribute("data-anchor", option.anchor);
		if (option.anchor === null) row.addClass("is-disabled");
		buttons.push({ anchor: option.anchor, el: row });

		// 选中标记由 CSS 的 ::before 绘制，无需额外的 DOM 节点。
		const textEl = row.createSpan({ cls: "easy-quiz-card__option-text" });
		// 选项文本是 Markdown（`**粗体**`、`H~2~O`、行内代码…），按 Markdown 渲染，
		// 否则标记字符会连同内容一起被吃掉。渲染失败时退回纯文本，选项不会变空。
		try {
			await MarkdownRenderer.render(ctx.app, option.markdown, textEl, ctx.file.path, component);
		} catch {
			textEl.setText(option.text);
		}
		// 渲染后若只剩空白（例如选项内容恰好是空字符串），退回纯文本兜底。
		if ((textEl.textContent ?? "").trim() === "" && option.markdown.trim() !== "") {
			textEl.setText(option.markdown);
		}

		const toggle = () => {
			const anchor = option.anchor;
			if (anchor === null) return;
			// 复盘态下选项只是"看答案"，不接受改选。
			if (review) return;
			if (multi) {
				if (selected.has(anchor)) selected.delete(anchor);
				else selected.add(anchor);
			} else {
				selected.clear();
				selected.add(anchor);
			}
			sync();
		};
		row.addEventListener("click", toggle);
		row.addEventListener("keydown", (event) => {
			if (event.key !== " " && event.key !== "Enter") return;
			event.preventDefault();
			toggle();
		});
	}

	// 复盘态：标出正确选项、淡化干扰项。
	// 必须在选项创建之后再做——这段逻辑原本放在循环之前，`buttons` 还是空的，
	// 结果复盘时选项完全没有高亮。
	if (review) {
		const expected = answerAnchors(question);
		for (const button of buttons) {
			if (button.anchor === null) continue;
			button.el.addClass(expected.includes(button.anchor) ? "is-answer" : "is-not-answer");
		}
	}

	renderSubmit(card, ctx, question, t("card.submit"), () =>
		selected.size === 0 ? null : { kind: "choice", anchors: [...selected] }
	);
}

// ---------------------------------------------------------------------------
// 填空题：题面里的空位可点击输入
// ---------------------------------------------------------------------------

function renderBlanks(question: QuizQuestion, bodyEl: HTMLElement, card: HTMLElement, ctx: CardContext): void {
	const fields = new Map<string, HTMLElement>();
	// 复盘态：空位里直接写出答案，而不是留一个可编辑的框。
	const review = ctx.reviewOnly === true;
	/** 复盘时已经写进题面的空位（题面里找不到的走下方列表）。 */
	const revealed = new Set<string>();

	// 把题面中的占位标记替换成可点击的空位。
	for (const blank of question.blanks) {
		const label = `${BLANK_MARKER_PREFIX}${blank.anchor}`;
		const placeholder = findTextElement(bodyEl, label);
		if (placeholder === null) continue;
		if (review) {
			placeholder.replaceWith(createSpan({ cls: "easy-quiz-card__blank-answer", text: blank.expected }));
			revealed.add(blank.anchor);
			continue;
		}
		const field = createBlankField(blank.anchor, fields);
		placeholder.replaceWith(field);
	}

	// 复盘态：题面里没能就地写出的空位仍然要在列表里给出答案。
	if (review) {
		if (revealed.size < question.blanks.length) {
			const list = card.createDiv({ cls: "easy-quiz-card__blanks" });
			for (const [index, blank] of question.blanks.entries()) {
				if (revealed.has(blank.anchor)) continue;
				const row = list.createDiv({ cls: "easy-quiz-card__blank" });
				row.createSpan({ text: t("card.blank.label", { index: index + 1 }) });
				row.createSpan({ cls: "easy-quiz-card__blank-answer", text: blank.expected });
			}
		}
		renderSubmit(card, ctx, question, t("card.submit"), () => null);
		return;
	}

	// 题面里没找到（例如题面为空）时，退化为逐空列表，保证仍可作答。
	const missing = question.blanks.filter((blank) => !fields.has(blank.anchor));
	if (missing.length > 0) {
		const list = card.createDiv({ cls: "easy-quiz-card__blanks" });
		for (const blank of missing) {
			const row = list.createDiv({ cls: "easy-quiz-card__blank" });
			row.createSpan({ text: t("card.blank.label", { index: question.blanks.indexOf(blank) + 1 }) });
			row.appendChild(createBlankField(blank.anchor, fields));
		}
	}

	renderSubmit(card, ctx, question, t("card.submit"), () => {
		const values = question.blanks.map((blank) => (fields.get(blank.anchor)?.textContent ?? "").trim());
		return values.every((value) => value === "") ? null : { kind: "blank", values };
	});
}

/**
 * 创建一个行内可编辑的空位。
 *
 * 用 `contenteditable` 而不是 `<input>`：空位的宽度直接由浏览器按实际文字排版决定，
 * 因此中英文都不会被裁掉（输入框需要插件自己算宽度，容易差半个字）。
 */
function createBlankField(anchor: string, fields: Map<string, HTMLElement>): HTMLElement {
	const field = createSpan({ cls: "easy-quiz-card__blank-input" });
	field.contentEditable = "true";
	field.setAttribute("role", "textbox");
	field.setAttribute("aria-label", t("card.blank.aria", { anchor }));
	field.dataset["anchor"] = anchor;
	// 空位时也能看出来这里可以填。
	field.dataset["empty"] = "true";
	field.addEventListener("input", () => {
		field.dataset["empty"] = (field.textContent ?? "") === "" ? "true" : "false";
	});
	// 空位是单行的，避免回车插入换行或换元素。
	field.addEventListener("keydown", (event) => {
		if (event.key === "Enter") event.preventDefault();
	});
	// 粘贴后清掉富文本格式，只保留纯文本。
	field.addEventListener("paste", () => {
		window.setTimeout(() => {
			const text = field.textContent ?? "";
			if (field.innerHTML !== text) field.textContent = text;
			field.dataset["empty"] = text === "" ? "true" : "false";
		}, 0);
	});
	fields.set(anchor, field);
	return field;
}

/** 在已渲染的题面里找到承载占位标记的元素（通常是内联 code）。 */
function findTextElement(root: HTMLElement, label: string): HTMLElement | null {
	const matches = (element: Element) => (element.textContent ?? "").trim() === label;
	const candidates = root.querySelectorAll("code, span, a, strong, em, del, mark");
	for (const candidate of Array.from(candidates)) {
		if (matches(candidate)) return candidate as HTMLElement;
	}
	// 退化：标记可能被包在其它内联元素里，逐层向下找。
	for (const element of Array.from(root.querySelectorAll("*"))) {
		if (element.children.length === 0 && matches(element)) return element as HTMLElement;
	}
	return null;
}

// ---------------------------------------------------------------------------
// 配对题：点击创建连线
// ---------------------------------------------------------------------------

/**
 * 配对题：多列题板 + 点击创建连线。
 *
 * - 首列是待匹配项，其余每一列都是一组需要配对的答案，各自渲染成一列。
 * - 各列顺序都会**独立打乱**，因此题目顺序不会泄露答案。
 * - 同一列内答案相同的条目已在解析阶段合并，所以不会出现重复选项；
 *   合并后的条目可能要对多个条目负责（多行重复文本），
 *   因此连线是「按线切换」而不是「改连即替换」，详见 `match-board.ts`。
 * - 点击已画出的连线可以删掉那一条；对连了多条线的合并条目，这比
 *   "记住两端再点一遍"更直接。
 * - 交互规则（选中、连线、取消连线、禁止跨列）都在 `match-board.ts` 的状态机里，
 *   这里只负责把状态画出来。
 */
export function renderMatch(question: QuizQuestion, card: HTMLElement, ctx: CardContext): void {
	const columns = question.board;
	if (columns.length < 2) {
		card.createDiv({ cls: "easy-quiz-card__hint", text: t("card.match.tooFewColumns") });
		return;
	}

	const board = card.createDiv({ cls: "easy-quiz-card__board" });
	const grid = board.createDiv({ cls: "easy-quiz-card__board-columns" });
	grid.style.setProperty("--easy-quiz-match-cols", `${columns.length}`);

	// 连线画在列之上的 SVG 层里。
	const svg = createSvg("svg", { cls: "easy-quiz-card__links" });
	board.appendChild(svg);

	/** 条目 key → 节点元素。 */
	const nodes = new Map<string, HTMLElement>();
	const columnEls = new Map<number, HTMLElement>();
	// 复盘态：节点不再可点，直接画出正确连线。
	const review = ctx.reviewOnly === true;

	for (const column of columns) {
		const col = createBoardColumn(grid, column.name);
		columnEls.set(column.index, col);
		// 每列各自打乱，避免行顺序泄露答案。
		for (const item of shuffle(column.items)) {
			const el = col.createDiv({
				cls: `easy-quiz-card__node${column.index === 0 ? " is-left" : ""}`,
				text: item.text,
			});
			nodes.set(item.key, el);
			if (!review) el.addEventListener("click", () => onNodeClick(item.key));
		}
	}

	const state = createBoardState(columns.flatMap((column) => column.items));
	if (review) {
		// 复用状态机：正确连线 = 依次"点中一端、再点另一端"，画出来的效果与玩家自己连的完全一致。
		for (const pair of question.boardPairs) {
			state.click(pair.left);
			state.click(pair.right);
		}
	}

	function onNodeClick(key: string): void {
		if (state.click(key)) paint();
	}

	function paint(): void {
		if (board.isConnected === false) return;
		// 题板尺寸：优先用容器自身，拿不到时退回到节点范围，避免布局尚未完成时不画线。
		const rect = board.getBoundingClientRect();
		let width = board.clientWidth;
		let height = board.clientHeight;
		if (width === 0 || height === 0) {
			let right = 0;
			let bottom = 0;
			for (const el of nodes.values()) {
				const nodeRect = el.getBoundingClientRect();
				right = Math.max(right, nodeRect.right - rect.left);
				bottom = Math.max(bottom, nodeRect.bottom - rect.top);
			}
			width = width === 0 ? right : width;
			height = height === 0 ? bottom : height;
		}
		if (width === 0 || height === 0) return;

		const view = state.view();
		svg.empty();
		svg.setAttribute("width", `${width}`);
		svg.setAttribute("height", `${height}`);
		svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
		for (const el of nodes.values()) el.removeClass("is-active", "is-linked");
		if (view.activeKey !== null) nodes.get(view.activeKey)?.addClass("is-active");

		const boardRect = board.getBoundingClientRect();
		for (const connection of view.connections) {
			const [leftId, rightId] = splitConnection(connection);
			if (leftId === null || rightId === null) continue;
			const leftEl = nodes.get(leftId);
			const rightEl = nodes.get(rightId);
			if (!leftEl || !rightEl) continue;
			leftEl.addClass("is-linked");
			rightEl.addClass("is-linked");
			const from = leftEl.getBoundingClientRect();
			const to = rightEl.getBoundingClientRect();
			const x1 = from.right - boardRect.left;
			const y1 = from.top + from.height / 2 - boardRect.top;
			const x2 = to.left - boardRect.left;
			const y2 = to.top + to.height / 2 - boardRect.top;
			const path = createSvg("path", { cls: "easy-quiz-card__link" });
			const mid = (x1 + x2) / 2;
			const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
			path.setAttribute("d", d);
			svg.appendChild(path);

			// 命中层：透明的粗线，只负责接收点击，用来删除这一条连线。
			// 复盘态下玩家连的线不该再被改动，因此不挂命中层。
			if (review) continue;
			const hit = createSvg("path", { cls: "easy-quiz-card__link-hit" });
			hit.setAttribute("d", d);
			hit.addEventListener("click", (event) => {
				event.stopPropagation();
				if (state.remove(connection)) paint();
			});
			svg.appendChild(hit);
		}
	}

	// 尺寸变化后重新画线，避免连线错位。
	// 观察者与卡片同生命周期：卡片被换掉时由 `onCleanup` 解除，避免观察已移除的节点。
	const observer = new ResizeObserver(() => paint());
	observer.observe(board);
	ctx.onCleanup?.(() => observer.disconnect());
	window.setTimeout(() => paint(), 0);

	renderSubmit(card, ctx, question, t("card.submit"), () => {
		const pairs = state.pairs();
		return pairs.length === 0 ? null : { kind: "match", pairs };
	});
}

function createBoardColumn(grid: HTMLElement, name: string): HTMLElement {
	const col = grid.createDiv({ cls: "easy-quiz-card__board-col" });
	col.createDiv({ cls: "easy-quiz-card__board-head", text: name });
	return col;
}

/** 拆出 `左节点|右节点`。 */
/** Fisher–Yates 打乱，返回新数组（不改动入参）。 */
function shuffle<T>(items: readonly T[]): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		const a = result[i];
		const b = result[j];
		if (a === undefined || b === undefined) continue;
		result[i] = b;
		result[j] = a;
	}
	return result;
}

// ---------------------------------------------------------------------------
// 问答题与提交
// ---------------------------------------------------------------------------

function renderEssay(question: QuizQuestion, card: HTMLElement, ctx: CardContext): void {
	// 复盘态：不再要一次自评，只把"参考答案见题面折叠块"的提示摊开。
	if (ctx.reviewOnly === true) {
		renderSubmit(card, ctx, question, t("card.essay.mastered"), () => null);
		return;
	}

	const area = card.createEl("textarea", { cls: "easy-quiz-card__essay" });
	area.placeholder = t("card.essay.placeholder");
	const row = card.createDiv({ cls: "easy-quiz-card__actions" });
	const passed = row.createEl("button", { text: t("card.essay.mastered"), cls: "mod-cta" });
	const failed = row.createEl("button", { text: t("card.essay.notMastered") });
	const feedback = card.createDiv({ cls: "easy-quiz-card__feedback" });

	const submitEssay = async (result: "correct" | "wrong") => {
		passed.disabled = true;
		failed.disabled = true;
		const outcome = await ctx.service.submit(ctx.file, question.id, { kind: "essay", result });
		if (outcome === null) {
			feedback.addClass("is-warning");
			feedback.setText(t("card.feedback.submitFailed"));
			passed.disabled = false;
			failed.disabled = false;
			return;
		}
		feedback.addClass(outcome.correct ? "is-correct" : "is-wrong");
		feedback.setText(outcome.correct ? t("card.feedback.recordedMastered") : t("card.feedback.recordedNotMastered"));
		ctx.onSubmitted?.(outcome);
		renderReview(card, question);
		ctx.onReview?.(outcome);
	};
	passed.addEventListener("click", () => void submitEssay("correct"));
	failed.addEventListener("click", () => void submitEssay("wrong"));
}

function renderSubmit(
	card: HTMLElement,
	ctx: CardContext,
	question: QuizQuestion,
	label: string,
	collect: () => UserAnswer | null
): void {
	// 刷题窗口的复盘态：不提供提交入口，直接把答案与解析摊开。
	if (ctx.reviewOnly === true) {
		renderReview(card, question);
		ctx.onReview?.(null);
		return;
	}

	const startedAt = Date.now();
	const row = card.createDiv({ cls: "easy-quiz-card__actions" });
	const button = row.createEl("button", { text: label, cls: "mod-cta" });
	const feedback = card.createDiv({ cls: "easy-quiz-card__feedback" });

	button.addEventListener("click", () => {
		void handleSubmit();
	});

	async function handleSubmit(): Promise<void> {
		const answer = collect();
		if (answer === null) {
			feedback.setText(t("card.feedback.answerFirst"));
			feedback.addClass("is-warning");
			return;
		}
		button.disabled = true;
		const result = await ctx.service.submit(ctx.file, question.id, answer, Date.now() - startedAt);
		if (result === null) {
			feedback.setText(t("card.feedback.submitFailed"));
			feedback.addClass("is-warning");
			button.disabled = false;
			return;
		}
		feedback.empty();
		feedback.removeClass("is-warning");
		feedback.addClass(result.correct ? "is-correct" : "is-wrong");
		feedback.createDiv({ text: result.correct ? t("card.feedback.correct") : t("card.feedback.wrong") });
		for (const detail of result.details) {
			if (detail.note) feedback.createDiv({ cls: "easy-quiz-card__note", text: detail.note });
		}
		ctx.onSubmitted?.(result);
		// 复盘内容由调用方决定：数据块渲染时留在原卡片里，刷题窗口则换成下一题。
		renderReview(card, question);
		ctx.onReview?.(result);
	}
}

/**
 * 把正确答案摊在题卡下方。
 *
 * 只在提交之后调用：选择题列出正确锚点，填空题给出每空原文，
 * 配对题补画正确连线（见 `renderMatch` 的复盘分支），问答/选择题的解析写在最后。
 */
function renderReview(card: HTMLElement, question: QuizQuestion): void {
	card.addClass("is-reviewed");
	const box = card.createDiv({ cls: "easy-quiz-card__review" });
	box.createDiv({ cls: "easy-quiz-card__review-head", text: t("card.review.head") });

	const answers = reviewAnswers(question);
	if (answers.length === 0) {
		box.createDiv({ cls: "easy-quiz-card__review-empty", text: t("card.review.empty") });
	} else {
		const list = box.createEl("ul", { cls: "easy-quiz-card__review-list" });
		for (const answer of answers) list.createEl("li", { text: answer });
	}

	if (question.explanation !== null && question.explanation.trim() !== "") {
		const note = box.createDiv({ cls: "easy-quiz-card__review-note" });
		note.createDiv({ cls: "easy-quiz-card__review-head", text: t("card.review.explanation") });
		// 解析是 Markdown，但复盘区只承载短文本；按纯文本渲染，避免再引入一次异步渲染。
		note.createDiv({ text: question.explanation.trim() });
	}
}

/** 一道题的正确答案文本（按题型给出人类可读形式）。 */
function reviewAnswers(question: QuizQuestion): string[] {
	switch (question.type) {
		case "single":
		case "multi": {
			const anchors = Array.isArray(question.answer)
				? question.answer
				: question.answer === null
					? []
					: [question.answer];
			return anchors.map((anchor) => {
				const option = question.options.find((item) => item.anchor === anchor);
				// 用 `plainText(markdown)` 而不是 `text`：后者为匹配做过规范化，
				// 会把 `~` 之类的字符删掉，复盘里就会与卡片上看到的选项对不上。
				return option ? t("grade.anchorLabel", { anchor, text: plainText(option.markdown) }) : anchor;
			});
		}
		case "blank":
			return question.blanks.map((blank, index) =>
				t("card.review.blank", { index: index + 1, expected: blank.expected })
			);
		case "match": {
			const text = new Map<string, string>();
			for (const column of question.board) {
				for (const item of column.items) text.set(item.key, item.text);
			}
			return question.boardPairs.map(
				(pair) => `${text.get(pair.left) ?? pair.left} — ${text.get(pair.right) ?? pair.right}`
			);
		}
		case "essay":
			return [t("card.review.essay")];
		default:
			return [];
	}
}
