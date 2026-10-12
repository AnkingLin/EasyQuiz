/**
 * 刷题界面渲染：把一道题渲染成可交互的题卡。
 *
 * 设计约束（README §1.3）：实时预览下光标进入会把渲染结果还原为源码，
 * 因此刷题在阅读视图/预览中完成；题卡本身不写文件，提交时统一交给 QuizService。
 */

import { App, MarkdownRenderer, setIcon, TFile } from "obsidian";
import { GradeResult, UserAnswer } from "./grade";
import { formatStats, QuizService, staleNote } from "./runtime";
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
	await MarkdownRenderer.render(ctx.app, stripAnswerMarkers(question), bodyEl, ctx.file.path, null as never);

	switch (question.type) {
		case "single":
		case "multi":
			renderChoice(question, card, ctx);
			break;
		case "blank":
			renderBlank(question, card, ctx);
			break;
		case "match":
			renderMatch(question, card, ctx);
			break;
		case "essay":
			renderEssay(question, card, ctx);
			break;
	}
}

/** 题面渲染前去掉机器标记：锚点与 `==答案==` 的等号包裹。 */
export function stripAnswerMarkers(question: QuizQuestion): string {
	return question.body
		.replace(/==([^=]+)==\s*\^([A-Za-z0-9\-_]+)/g, (_match, _answer: string, anchor: string) => `\`{{${anchor}}}\``)
		.replace(/\s\^[A-Za-z0-9\-_]+/gm, "");
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
// 各题型交互
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

function renderBlank(question: QuizQuestion, card: HTMLElement, ctx: CardContext): void {
	const inputs: HTMLInputElement[] = [];
	const list = card.createDiv({ cls: "easy-quiz-card__blanks" });
	for (let index = 0; index < question.blanks.length; index++) {
		const row = list.createDiv({ cls: "easy-quiz-card__blank" });
		row.createSpan({ text: `第 ${index + 1} 空` });
		inputs.push(row.createEl("input", { type: "text" }));
	}
	renderSubmit(card, ctx, question, "提交答案", () => {
		const values = inputs.map((input) => input.value);
		return values.every((value) => value.trim() === "") ? null : { kind: "blank", values };
	});
}

function renderMatch(question: QuizQuestion, card: HTMLElement, ctx: CardContext): void {
	// 选项 = 表格右侧出现过的全部答案；每个待匹配条目选一个。
	const targets = [...new Set(question.matchItems.flatMap((item) => item.actualTargets))];
	const chosen = new Map<string, HTMLSelectElement>();
	const list = card.createDiv({ cls: "easy-quiz-card__matches" });
	for (const item of question.matchItems) {
		const row = list.createDiv({ cls: "easy-quiz-card__match" });
		row.createSpan({ cls: "easy-quiz-card__match-item", text: item.text });
		const select = row.createEl("select");
		select.createEl("option", { text: "请选择", value: "" });
		for (const target of targets) {
			select.createEl("option", { text: target, value: target });
		}
		chosen.set(item.key, select);
	}
	renderSubmit(card, ctx, question, "提交答案", () => {
		const pairs = [...chosen.entries()].map(([key, select]) => ({ key, target: select.value }));
		return pairs.every((pair) => pair.target === "") ? null : { kind: "match", pairs };
	});
}

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
