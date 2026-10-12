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
import { createBoardState, splitConnection } from "./match-board";
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
}

const TYPE_LABEL: Record<string, string> = {
	single: "单选",
	multi: "多选",
	match: "配对",
	blank: "填空",
	essay: "问答",
};

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
	const typeLabel = question.type ? TYPE_LABEL[question.type] ?? question.type : "未知";
	header.createSpan({ cls: "easy-quiz-card__type", text: typeLabel });
	header.createSpan({ cls: "easy-quiz-card__title", text: question.title });
	header.createSpan({
		cls: `easy-quiz-card__stats${question.stale ? " is-stale" : ""}`,
		text: formatStats(question),
	});

	const stale = staleNote(question);
	if (stale) {
		card.createDiv({ cls: "easy-quiz-card__stale", text: stale });
	}

	const bodyEl = card.createDiv({ cls: "easy-quiz-card__body" });
	const stem = formatStem(question, ctx.blankMarker);
	if (stem.trim() !== "") {
		// Obsidian 要求传入承载生命周期的 Component：传 null 会直接抛错，
		// 并使这一道题后续的渲染（包括题板）全部中断。
		let component = ctx.renderComponent;
		if (component === undefined) {
			const child = new MarkdownRenderChild(bodyEl);
			ctx.addRenderChild?.(child);
			component = child;
		}
		await MarkdownRenderer.render(ctx.app, stem, bodyEl, ctx.file.path, component);
	}

	switch (question.type) {
		case "single":
		case "multi":
			renderChoice(question, card, ctx);
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
// 诊断卡片（降级题）
// ---------------------------------------------------------------------------

function renderDiagnostics(question: QuizQuestion, card: HTMLElement): void {
	card.addClass("is-diagnostic");
	const header = card.createDiv({ cls: "easy-quiz-card__header" });
	const icon = header.createSpan({ cls: "easy-quiz-card__icon" });
	setIcon(icon, "alert-triangle");
	header.createSpan({ cls: "easy-quiz-card__title", text: question.title });
	card.createDiv({ cls: "easy-quiz-card__hint", text: "这道题暂时不能作答，请修正数据块后重试：" });
	const list = card.createEl("ul", { cls: "easy-quiz-card__warnings" });
	if (question.warnings.length === 0) {
		list.createEl("li", { text: "题目数据不完整。" });
		return;
	}
	for (const warning of question.warnings) {
		const line = warning.line === null ? "" : `（第 ${warning.line + 1} 行）`;
		list.createEl("li", { text: `${warning.message}${line}` });
	}
}

// ---------------------------------------------------------------------------
// 选择题
// ---------------------------------------------------------------------------

function renderChoice(question: QuizQuestion, card: HTMLElement, ctx: CardContext): void {
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

	for (const option of question.options) {
		// 用普通按钮而不是 <input type="radio">：避免表单控件在阅读视图里的原生行为
		// （重渲染、键盘默认动作）干扰数据块渲染。
		const row = list.createDiv({ cls: "easy-quiz-card__option" });
		row.setAttribute("role", multi ? "checkbox" : "radio");
		row.setAttribute("aria-checked", "false");
		row.tabIndex = 0;
		if (option.anchor === null) row.addClass("is-disabled");
		buttons.push({ anchor: option.anchor, el: row });

		// 选中标记由 CSS 的 ::before 绘制，无需额外的 DOM 节点。
		row.createSpan({ cls: "easy-quiz-card__option-text", text: option.text });

		const toggle = () => {
			const anchor = option.anchor;
			if (anchor === null) return;
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

	renderSubmit(card, ctx, question, "提交答案", () =>
		selected.size === 0 ? null : { kind: "choice", anchors: [...selected] }
	);
}

// ---------------------------------------------------------------------------
// 填空题：题面里的空位可点击输入
// ---------------------------------------------------------------------------

function renderBlanks(question: QuizQuestion, bodyEl: HTMLElement, card: HTMLElement, ctx: CardContext): void {
	const fields = new Map<string, HTMLElement>();

	// 把题面中的占位标记替换成可点击的空位。
	for (const blank of question.blanks) {
		const label = `${BLANK_MARKER_PREFIX}${blank.anchor}`;
		const placeholder = findTextElement(bodyEl, label);
		if (placeholder === null) continue;
		const field = createBlankField(blank.anchor, fields);
		placeholder.replaceWith(field);
	}

	// 题面里没找到（例如题面为空）时，退化为逐空列表，保证仍可作答。
	const missing = question.blanks.filter((blank) => !fields.has(blank.anchor));
	if (missing.length > 0) {
		const list = card.createDiv({ cls: "easy-quiz-card__blanks" });
		for (const blank of missing) {
			const row = list.createDiv({ cls: "easy-quiz-card__blank" });
			row.createSpan({ text: `第 ${question.blanks.indexOf(blank) + 1} 空` });
			row.appendChild(createBlankField(blank.anchor, fields));
		}
	}

	renderSubmit(card, ctx, question, "提交答案", () => {
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
	field.setAttribute("aria-label", `填空 ${anchor}`);
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
 *   合并后的条目可能要对多个条目负责（斜杠一对多 / 多行重复文本），
 *   因此连线是「按线切换」而不是「改连即替换」，详见 `match-board.ts`。
 * - 点击已画出的连线可以删掉那一条；对连了多条线的合并条目，这比
 *   "记住两端再点一遍"更直接。
 * - 交互规则（选中、连线、取消连线、禁止跨列）都在 `match-board.ts` 的状态机里，
 *   这里只负责把状态画出来。
 */
export function renderMatch(question: QuizQuestion, card: HTMLElement, ctx: CardContext): void {
	const columns = question.board;
	if (columns.length < 2) {
		card.createDiv({ cls: "easy-quiz-card__hint", text: "配对表格至少需要两列才能连线。" });
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
			el.addEventListener("click", () => onNodeClick(item.key));
		}
	}

	const state = createBoardState(columns.flatMap((column) => column.items));

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
	const observer = new ResizeObserver(() => paint());
	observer.observe(board);
	window.setTimeout(() => paint(), 0);

	renderSubmit(card, ctx, question, "提交答案", () => {
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
	const area = card.createEl("textarea", { cls: "easy-quiz-card__essay" });
	area.placeholder = "写下你的答案，再自评是否掌握。";
	const row = card.createDiv({ cls: "easy-quiz-card__actions" });
	const passed = row.createEl("button", { text: "已掌握", cls: "mod-cta" });
	const failed = row.createEl("button", { text: "未掌握" });
	const feedback = card.createDiv({ cls: "easy-quiz-card__feedback" });

	const submitEssay = async (result: "correct" | "wrong") => {
		passed.disabled = true;
		failed.disabled = true;
		const outcome = await ctx.service.submit(ctx.file, question.id, { kind: "essay", result });
		if (outcome === null) {
			feedback.addClass("is-warning");
			feedback.setText("提交失败：题目可能已被修改或数据块无法写入。");
			passed.disabled = false;
			failed.disabled = false;
			return;
		}
		feedback.addClass(outcome.correct ? "is-correct" : "is-wrong");
		feedback.setText(outcome.correct ? "已记录：掌握" : "已记录：未掌握");
		ctx.onSubmitted?.(outcome);
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
			feedback.setText("请先作答。");
			feedback.addClass("is-warning");
			return;
		}
		button.disabled = true;
		const result = await ctx.service.submit(ctx.file, question.id, answer, Date.now() - startedAt);
		if (result === null) {
			feedback.setText("提交失败：题目可能已被修改或数据块无法写入。");
			feedback.addClass("is-warning");
			button.disabled = false;
			return;
		}
		feedback.empty();
		feedback.removeClass("is-warning");
		feedback.addClass(result.correct ? "is-correct" : "is-wrong");
		feedback.createDiv({ text: result.correct ? "回答正确" : "回答错误" });
		for (const detail of result.details) {
			if (detail.note) feedback.createDiv({ cls: "easy-quiz-card__note", text: detail.note });
		}
		ctx.onSubmitted?.(result);
	}
}
