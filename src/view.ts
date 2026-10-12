/**
 * 刷题界面渲染：把一道题渲染成可交互的题卡。
 *
 * 设计约束（README §1.3）：实时预览下光标进入会把渲染结果还原为源码，
 * 因此刷题在阅读视图/预览中完成；题卡本身不写文件，提交时统一交给 QuizService。
 *
 * 渲染分工：题面只渲染"非交互部分"——选择题的选项列表、配对题的表格、
 * 填空题的 `==答案==` 由各自的交互控件承担，避免同一内容出现两次。
 */

import { App, MarkdownRenderer, setIcon, TFile } from "obsidian";
import { GradeResult, UserAnswer } from "./grade";
import { formatStats, QuizService, staleNote } from "./runtime";
import { BLANK_MARKER_PREFIX, formatStem } from "./stem";
import { QuizQuestion } from "./types";

export interface CardContext {
	app: App;
	service: QuizService;
	file: TFile;
	/** 题卡根容器。 */
	el: HTMLElement;
	/** 数据块所在行（用于把题卡与源码位置对应起来）。 */
	blockLine?: number;
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
	const stem = formatStem(question);
	if (stem.trim() !== "") {
		await MarkdownRenderer.render(ctx.app, stem, bodyEl, ctx.file.path, null as never);
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
	for (const option of question.options) {
		const row = list.createEl("label", { cls: "easy-quiz-card__option" });
		const input = row.createEl("input", { type: multi ? "checkbox" : "radio" });
		input.name = `easy-quiz-${question.id}`;
		if (option.anchor === null) {
			input.disabled = true;
		}
		input.addEventListener("change", () => {
			if (option.anchor === null) return;
			if (multi) {
				if (input.checked) selected.add(option.anchor);
				else selected.delete(option.anchor);
			} else {
				selected.clear();
				selected.add(option.anchor);
			}
		});
		row.createSpan({ cls: "easy-quiz-card__option-text", text: option.text });
	}
	renderSubmit(card, ctx, question, "提交答案", () =>
		selected.size === 0 ? null : { kind: "choice", anchors: [...selected] }
	);
}

// ---------------------------------------------------------------------------
// 填空题：题面里的空位可点击输入
// ---------------------------------------------------------------------------

function renderBlanks(question: QuizQuestion, bodyEl: HTMLElement, card: HTMLElement, ctx: CardContext): void {
	const inputs = new Map<string, string>();

	// 把题面中的占位标记替换成可点击的空位。
	for (const blank of question.blanks) {
		const label = `${BLANK_MARKER_PREFIX}${blank.anchor}`;
		const placeholder = findTextElement(bodyEl, label);
		if (placeholder === null) continue;
		const input = createBlankInput(blank.anchor, inputs);
		placeholder.replaceWith(input);
	}

	// 题面里没找到（例如题面为空）时，退化为逐空列表，保证仍可作答。
	const missing = question.blanks.filter((blank) => !inputs.has(blank.anchor));
	if (missing.length > 0) {
		const list = card.createDiv({ cls: "easy-quiz-card__blanks" });
		for (const blank of missing) {
			const row = list.createDiv({ cls: "easy-quiz-card__blank" });
			row.createSpan({ text: `第 ${question.blanks.indexOf(blank) + 1} 空` });
			const input = createBlankInput(blank.anchor, inputs);
			row.appendChild(input);
		}
	}

	renderSubmit(card, ctx, question, "提交答案", () => {
		const values = question.blanks.map((blank) => (inputs.get(blank.anchor) ?? "").trim());
		return values.every((value) => value === "") ? null : { kind: "blank", values };
	});
}

/** 创建一个下划线样式的空位输入框，点击即可输入。 */
function createBlankInput(anchor: string, inputs: Map<string, string>): HTMLInputElement {
	const input = createEl("input", { cls: "easy-quiz-card__blank-input" });
	input.type = "text";
	input.dataset["anchor"] = anchor;
	input.size = 8;
	inputs.set(anchor, "");
	const sync = () => {
		inputs.set(anchor, input.value);
		input.style.width = `${Math.max(4, input.value.length + 2)}ch`;
	};
	input.addEventListener("input", sync);
	return input;
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

interface Connection {
	/** 左侧条目 key。 */
	key: string;
	/** 右侧答案文本。 */
	target: string;
}

function renderMatch(question: QuizQuestion, card: HTMLElement, ctx: CardContext): void {
	const targets = [...new Set(question.matchItems.flatMap((item) => item.actualTargets))];
	const connections = new Map<string, Connection>();
	let activeItemKey: string | null = null;

	const board = card.createDiv({ cls: "easy-quiz-card__board" });
	const columns = board.createDiv({ cls: "easy-quiz-card__board-columns" });
	const leftCol = columns.createDiv({ cls: "easy-quiz-card__board-col is-left" });
	const rightCol = columns.createDiv({ cls: "easy-quiz-card__board-col is-right" });

	// 连线画在列之上的 SVG 层里。
	const svg = createSvg("svg", { cls: "easy-quiz-card__links" });
	board.appendChild(svg);

	const leftEls = new Map<string, HTMLElement>();
	const rightEls = new Map<string, HTMLElement>();

	const leftItems = dedupeByKey(question.matchItems);
	for (const item of leftItems) {
		const el = leftCol.createDiv({ cls: "easy-quiz-card__node is-left", text: item.text });
		leftEls.set(item.key, el);
		el.addEventListener("click", () => {
			// 已连线的条目：再次点击即断开。
			if (connections.has(item.key)) {
				connections.delete(item.key);
				activeItemKey = null;
				paint();
				return;
			}
			activeItemKey = activeItemKey === item.key ? null : item.key;
			paint();
		});
	}

	for (const target of targets) {
		const el = rightCol.createDiv({ cls: "easy-quiz-card__node is-right", text: target });
		rightEls.set(target, el);
		el.addEventListener("click", () => {
			if (activeItemKey === null) {
				// 未选左侧条目时，点击右侧取消连到该答案的连线。
				for (const [key, connection] of connections) {
					if (connection.target === target) connections.delete(key);
				}
				paint();
				return;
			}
			// 一个答案只能连一条线：先解除该答案上已有的连线。
			for (const [key, connection] of connections) {
				if (connection.target === target) connections.delete(key);
			}
			connections.set(activeItemKey, { key: activeItemKey, target });
			activeItemKey = null;
			paint();
		});
	}

	function paint(): void {
		// 视图已被移除时不再绘制，避免操作脱离文档的节点。
		if (!board.isConnected) return;
		const width = board.clientWidth;
		const height = board.clientHeight;
		if (width === 0 || height === 0) return;

		svg.empty();
		svg.setAttribute("width", `${width}`);
		svg.setAttribute("height", `${height}`);
		svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
		for (const el of leftEls.values()) el.removeClass("is-active", "is-linked");
		for (const el of rightEls.values()) el.removeClass("is-active", "is-linked");
		if (activeItemKey !== null) leftEls.get(activeItemKey)?.addClass("is-active");

		const boardRect = board.getBoundingClientRect();
		for (const connection of connections.values()) {
			const left = leftEls.get(connection.key);
			const right = rightEls.get(connection.target);
			if (!left || !right) continue;
			left.addClass("is-linked");
			right.addClass("is-linked");
			const from = left.getBoundingClientRect();
			const to = right.getBoundingClientRect();
			const x1 = from.right - boardRect.left;
			const y1 = from.top + from.height / 2 - boardRect.top;
			const x2 = to.left - boardRect.left;
			const y2 = to.top + to.height / 2 - boardRect.top;
			const path = createSvg("path", { cls: "easy-quiz-card__link" });
			const mid = (x1 + x2) / 2;
			path.setAttribute("d", `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`);
			svg.appendChild(path);
		}
	}

	// 尺寸变化后重新画线，避免连线错位。
	const observer = new ResizeObserver(() => paint());
	observer.observe(board);
	window.setTimeout(() => paint(), 0);

	renderSubmit(card, ctx, question, "提交答案", () => {
		const pairs = [...connections.values()].map((connection) => ({
			key: connection.key,
			target: connection.target,
		}));
		return pairs.length === 0 ? null : { kind: "match", pairs };
	});
}

/** 同一条目可能因一对多而出现多次，按 key 去重。 */
function dedupeByKey(items: QuizQuestion["matchItems"]): QuizQuestion["matchItems"] {
	const seen = new Set<string>();
	const result: QuizQuestion["matchItems"] = [];
	for (const item of items) {
		if (seen.has(item.key)) continue;
		seen.add(item.key);
		result.push(item);
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
