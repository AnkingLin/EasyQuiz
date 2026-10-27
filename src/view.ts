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
import { GradeResult, matchBlank, UserAnswer } from "./grade";
import { contentHash } from "./hash";
import { t } from "./i18n";
import { typeLabel } from "./labels";
import { createBoardState, splitConnection } from "./match-board";
import { plainText } from "./plain-text";
import { formatStats, QuizService, staleNote } from "./runtime";
import { seededRandom } from "./session";
import { BLANK_MARKER_PREFIX, formatStem, formatSupplement } from "./stem";
import { BlankMarkerMode, QuizOption, QuizQuestion } from "./types";

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
	 * 打乱选择题的选项顺序（刷题窗口「打乱顺序」开关）。
	 * 题目自己在数据块里写的 `shuffle: true` 同样生效，两者是「或」的关系。
	 * 判分始终按锚点，因此选项换位不会改变对错（见 `grade.ts` 的 `gradeChoice`）。
	 */
	shuffleOptions?: boolean;
	/**
	 * 选项打乱用的会话种子。同一轮里保持不变，选项顺序因此在复盘、切题来回时不跳位。
	 * 不传时按题目 id 派生，效果是「每道题有自己固定的一套顺序」——笔记里重渲染
	 * 也不会让选项跳来跳去。
	 */
	shuffleSeed?: number;
	/**
	 * 承载 MarkdownRenderer 生命周期的 Component。
	 * 不传时插件会自己创建一个 MarkdownRenderChild，并通过 `addRenderChild` 注册。
	 */
	renderComponent?: Component;
	/** 把自建的 MarkdownRenderChild 交给 Obsidian 的渲染上下文托管。 */
	addRenderChild?: (child: MarkdownRenderChild) => void;
	/** 提交完成后回调（用于刷新统计角标；第二个参数是这次提交的作答内容）。 */
	onSubmitted?: (result: GradeResult, answer?: UserAnswer) => void;
	/**
	 * 上一次的作答内容（刷题窗口切回已答题目时传入）。
	 * 复盘态用它把"你的选择/填写/连线/自评"标在答案旁边，而不是只给出正确答案。
	 */
	lastAnswer?: UserAnswer;
	/**
	 * 复盘模式（刷题窗口用）：不挂提交按钮，改为直接显示正确答案与解析。
	 * 数据块渲染出的题卡不使用这个模式——那里的"看答案"就是重新读一遍源码。
	 */
	reviewOnly?: boolean;
	/** 复盘渲染完成后的回调，参数是这次作答的结果；提交页用它把卡片切到复盘视图。 */
	onReview?: (result: GradeResult | null) => void;
	/**
	 * 右上角"编辑"按钮的回调：跳到题库里这道题的标题行。
	 * 只有刷题窗口会传；笔记里就地渲染的题卡本来就在原题上，不需要这个按钮。
	 */
	onOpenSource?: () => void;
	/** 题卡渲染结束（含题板布局完成）后回调，用于解除观察者等自身资源。 */
	onCleanup?: (cleanup: () => void) => void;
}

/** 选择题的正确答案锚点列表（单选也会被收成数组）。 */
function answerAnchors(question: QuizQuestion): string[] {
	if (question.answer === null) return [];
	return Array.isArray(question.answer) ? question.answer : [question.answer];
}

/** 带锚点的选项；没有锚点的选项在部分缺省时不进入题面。 */
type AnchoredOption = QuizOption & { anchor: string };

/** 只取有锚点的选项：部分缺省时，没写锚点的选项直接从题面隐藏。 */
function anchoredOptions(question: QuizQuestion): AnchoredOption[] {
	return question.options.filter((option): option is AnchoredOption => option.anchor !== null);
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
	// 数据块里写了 `question:` 时用它代替标题作为题面标题（标题仍用于锚定题目边界）。
	header.createSpan({ cls: "easy-quiz-card__title", text: question.displayTitle ?? question.title });
	header.createSpan({
		cls: `easy-quiz-card__stats${question.stale ? " is-stale" : ""}`,
		text: formatStats(question),
	});
	// 跳到题库里的原题：放在右上角，和链接跳转一样定位到标题行。
	if (ctx.onOpenSource !== undefined) {
		const open = header.createEl("button", { cls: "clickable-icon easy-quiz-card__edit" });
		open.type = "button";
		open.setAttribute("aria-label", t("practice.session.openNote"));
		open.setAttribute("title", t("practice.session.openNote"));
		setIcon(open, "pencil");
		open.addEventListener("click", (event) => {
			event.preventDefault();
			event.stopPropagation();
			ctx.onOpenSource?.();
		});
	}
	renderKnowledgeLink(question, card, ctx);

	const stale = staleNote(question);
	if (stale) {
		card.createDiv({ cls: "easy-quiz-card__stale", text: stale });
	}

	const bodyEl = card.createDiv({ cls: "easy-quiz-card__body markdown-rendered" });

	// Obsidian 要求传入承载生命周期的 Component：传 null 会直接抛错，
	// 并使这一道题后续的渲染（包括题板）全部中断。
	// 题面、选项与解析都要渲染 Markdown，因此整张卡片共用一个，而不是各建一份。
	const component = cardComponent(card, ctx);

	const stem = formatStem(question, ctx.blankMarker);
	if (stem.trim() !== "") {
		await MarkdownRenderer.render(ctx.app, stem, bodyEl, ctx.file.path, component);
	}

	// 补充内容：题面最近一块结构（列表/表格/段落）之后、与它没有空行间隔的那段文字。
	// 它不属于题面，但作者写在这里通常正是为了说明选项/表格，因此紧跟题面显示。
	const supplement = formatSupplement(question, ctx.blankMarker);
	if (supplement.trim() !== "") {
		const supplementEl = card.createDiv({ cls: "easy-quiz-card__supplement markdown-rendered" });
		await MarkdownRenderer.render(ctx.app, supplement, supplementEl, ctx.file.path, component);
	}

	switch (question.type) {
		case "single":
		case "multi":
			await renderChoice(question, card, ctx, component);
			break;
		case "blank":
			await renderBlanks(question, bodyEl, card, ctx, component);
			break;
		case "match":
			renderMatch(question, card, ctx, component);
			break;
		case "essay":
			await renderEssay(question, card, ctx, component);
			break;
	}
}

/**
 * 题卡 Markdown 渲染用的 Component。
 *
 * 传入 `ctx.renderComponent` 时直接复用（宿主已经托管了它的生命周期）；否则自建一个
 * `MarkdownRenderChild` 并通过 `ctx.addRenderChild` 交给宿主。**必须注册**：没有加载的
 * Component，`MarkdownRenderer` 创建的子组件（图片、嵌入块）不会 `onload`，题面里的
 * `![[图片]]` 就永远不显示。
 */
function cardComponent(card: HTMLElement, ctx: CardContext): Component {
	if (ctx.renderComponent !== undefined) return ctx.renderComponent;
	const child = new MarkdownRenderChild(card);
	ctx.addRenderChild?.(child);
	return child;
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
 * 两个要点：
 *
 * 1. **选项按 Markdown 渲染**（`option.markdown`，已去掉锚点）。早期版本直接把
 *    `option.text` 当纯文本塞进 `textContent`，而 `text` 是给匹配用的规范化结果
 *    （`normalizeText` 会删掉 `*` `_` `` ` `` `~`），于是 `H~2~O` 显示成 `H2O`、
 *    `~5%` 显示成 `5%`。选项是作者写的 Markdown，就该按 Markdown 渲染。
 *    行内渲染（`MarkdownRenderer.render`）不会破坏选项行的排版，也不会渲染
 *    多行块结构——选项本身是单行列表项。
 *
 * 2. **判分永远按锚点**，所以打乱选项位置不会影响对错：`renderChoice` 只改
 *    DOM 顺序，提交的仍是 `{ anchors: [...] }`（见 `grade.ts` 的 `gradeChoice`）。
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
	const buttons: { anchor: string; el: HTMLElement }[] = [];

	const sync = () => {
		for (const button of buttons) {
			const isSelected = selected.has(button.anchor);
			button.el.toggleClass("is-selected", isSelected);
			button.el.setAttribute("aria-checked", isSelected ? "true" : "false");
		}
	};

	// 复盘态：把正确选项标出来（提交后由 renderSubmit 统一驱动复盘）。
	const review = ctx.reviewOnly === true;

	// 打乱选项位置：刷题窗口的「打乱顺序」开关，或题目自己写的 `shuffle: true`。
	// 锚点跟着选项一起走，因此判分不受影响。
	//
	// 顺序必须**可复现**：一次渲染里随机的结果，在复盘重画、上一题/下一题来回切的时候
	// 会重新洗一遍，用户刚记住的位置就变了，看起来像"答案认错了"。因此用内容哈希
	// 派生的种子，同一道题永远得到同一套顺序（换一轮由 `shuffleSeed` 变）。
	const randomize = ctx.shuffleOptions === true || question.shuffle;
	// 干扰项只影响"看到哪些选项"，不参与判分：它们使用 `~d1` 这类作者无法写出的锚点，
	// 提交的作答里永远不会出现，正确答案的锚点集合也不包含它们。
	const options = choiceOptions(question, randomize, ctx.shuffleSeed, review);

	// 复盘态里把用户上次的选择重新标出来（刷题窗口切回已答题目时）。
	const lastAnswer = ctx.lastAnswer?.kind === "choice" ? ctx.lastAnswer : null;
	if (lastAnswer !== null) {
		for (const anchor of lastAnswer.anchors) selected.add(anchor);
	}

	for (const option of options) {
		// 用普通按钮而不是 <input type="radio">：避免表单控件在阅读视图里的原生行为
		// （重渲染、键盘默认动作）干扰数据块渲染。
		const row = list.createDiv({ cls: "easy-quiz-card__option" });
		row.setAttribute("role", multi ? "checkbox" : "radio");
		row.setAttribute("aria-checked", "false");
		row.tabIndex = 0;
		// 把锚点写到行上：选项顺序可能被打乱，外部（README 素材生成器、将来的自动化）
		// 因此不能靠"第几个渲染出来的选项"来定位，只能靠锚点。
		row.setAttribute("data-anchor", option.anchor);
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

	// 复盘态：标出正确选项、淡化干扰项，并把用户上次选中/选错的项标出来。
	// 必须在选项创建之后再做——这段逻辑原本放在循环之前，`buttons` 还是空的，
	// 结果复盘时选项完全没有高亮。
	if (review) {
		const expected = answerAnchors(question);
		for (const button of buttons) {
			const picked = selected.has(button.anchor);
			const isAnswer = expected.includes(button.anchor);
			button.el.addClass(isAnswer ? "is-answer" : "is-not-answer");
			if (picked) {
				button.el.addClass("is-selected");
				button.el.setAttribute("aria-checked", "true");
				// 选对的打绿色勾、选错的打红色叉；没选但正确的选项保持"正确答案"的高亮。
				button.el.addClass(isAnswer ? "is-correct" : "is-wrong");
			}
		}
	}

	await renderSubmit(
		card,
		ctx,
		question,
		t("card.submit"),
		() => (selected.size === 0 ? null : { kind: "choice", anchors: [...selected] }),
		component
	);
}

// ---------------------------------------------------------------------------
// 填空题：题面里的空位可点击输入
// ---------------------------------------------------------------------------

async function renderBlanks(
	question: QuizQuestion,
	bodyEl: HTMLElement,
	card: HTMLElement,
	ctx: CardContext,
	component: Component
): Promise<void> {
	const fields = new Map<string, HTMLElement>();
	// 复盘态：空位里直接写出答案，而不是留一个可编辑的框。
	const review = ctx.reviewOnly === true;
	/** 复盘时已经写进题面的空位（题面里找不到的走下方列表）。 */
	const revealed = new Set<string>();

	// 复盘态里把用户上次填的内容也写回空位；填错时用箭头补上正确答案。
	const userValues = ctx.lastAnswer?.kind === "blank" ? ctx.lastAnswer.values : [];

	// 把题面中的占位标记替换成可点击的空位。
	for (const [index, blank] of question.blanks.entries()) {
		const label = `${BLANK_MARKER_PREFIX}${blank.anchor}`;
		const placeholder = findTextElement(bodyEl, label);
		if (placeholder === null) continue;
		if (review) {
			const entered = (userValues[index] ?? "").trim();
			const passed =
				entered !== "" && matchBlank(entered, blank.expected, question.blankRules[blank.anchor]);
			const holder = createSpan({ cls: "easy-quiz-card__blank-compare" });
			if (entered === "") {
				holder.createSpan({ cls: "easy-quiz-card__blank-answer", text: blank.expected });
			} else {
				holder.createSpan({
					cls: `easy-quiz-card__blank-answer is-user${passed ? " is-correct" : " is-wrong"}`,
					text: entered,
				});
				if (!passed) {
					holder.createSpan({ cls: "easy-quiz-card__blank-expected", text: ` → ${blank.expected}` });
				}
			}
			placeholder.replaceWith(holder);
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
				const entered = (userValues[index] ?? "").trim();
				const passed =
					entered !== "" && matchBlank(entered, blank.expected, question.blankRules[blank.anchor]);
				if (entered === "" || passed) {
					row.createSpan({ cls: "easy-quiz-card__blank-answer", text: blank.expected });
				} else {
					row.createSpan({ cls: "easy-quiz-card__blank-answer is-user is-wrong", text: entered });
					row.createSpan({ cls: "easy-quiz-card__blank-expected", text: ` → ${blank.expected}` });
				}
			}
		}
		await renderSubmit(card, ctx, question, t("card.submit"), () => null, component);
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

	await renderSubmit(card, ctx, question, t("card.submit"), () => {
		const values = question.blanks.map((blank) => (fields.get(blank.anchor)?.textContent ?? "").trim());
		return values.every((value) => value === "") ? null : { kind: "blank", values };
	}, component);
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
 * 单元格文字是否含有需要 Markdown 处理的标记。
 *
 * 配对题节点通常就是纯文本（"TCP"、"80"），没有标记时直接跳过渲染：
 * 每个节点一次异步渲染没有任何视觉收益，反而拖慢题板出现。
 */
const INLINE_MARKDOWN = /[*_`~=[\]<>!$\\]|https?:\/\//;

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
export function renderMatch(
	question: QuizQuestion,
	card: HTMLElement,
	ctx: CardContext,
	renderComponent?: Component
): void {
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
			});
			// 表格单元格是作者写的 Markdown（`**粗体**`、行内代码…）。节点先放纯文本，
			// 渲染结果出来后再整体替换：渲染器可能"追加"而不是"清空"，直接渲染进非空
			// 节点会让文字出现两遍。纯文本单元格（绝大多数）不做一次无意义的渲染。
			const label = el.createSpan({ cls: "easy-quiz-card__node-text", text: item.text });
			if (INLINE_MARKDOWN.test(item.text)) void renderNodeText(label, item.text, ctx, renderComponent);
			nodes.set(item.key, el);
			if (!review) el.addEventListener("click", () => onNodeClick(item.key));
		}
	}

	const state = createBoardState(columns.flatMap((column) => column.items));
	if (review) {
		// 复用状态机：正确答案 = 依次"点中一端、再点另一端"，画出来的效果与玩家自己连的完全一致。
		// 有上次作答时优先回放用户连的线，画线阶段再把连错的那几条标红。
		const pairs = ctx.lastAnswer?.kind === "match" && ctx.lastAnswer.pairs.length > 0
			? ctx.lastAnswer.pairs
			: question.boardPairs;
		for (const pair of pairs) {
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
			// 复盘时用户连错的那几条用红色虚线标出，其余仍按正确答案的样式。
			if (review && !isExpectedConnection(question, leftId, rightId)) path.addClass("is-wrong");
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

	void renderSubmit(
		card,
		ctx,
		question,
		t("card.submit"),
		() => {
			const pairs = state.pairs();
			return pairs.length === 0 ? null : { kind: "match", pairs };
		},
		renderComponent ?? cardComponent(card, ctx)
	);
}

/** 两个节点是否构成一条正确连线（方向无关）。 */
function isExpectedConnection(question: QuizQuestion, left: string, right: string): boolean {
	return question.boardPairs.some(
		(pair) => (pair.left === left && pair.right === right) || (pair.left === right && pair.right === left)
	);
}

/** 把题板节点的表格文字按 Markdown 渲染（见调用处的说明）。 */
async function renderNodeText(
	target: HTMLElement,
	markdown: string,
	ctx: CardContext,
	renderComponent?: Component
): Promise<void> {
	if (markdown.trim() === "") return;
	const holder = createDiv();
	try {
		await MarkdownRenderer.render(
			ctx.app,
			markdown,
			holder,
			ctx.file.path,
			renderComponent ?? cardComponent(target, ctx)
		);
	} catch {
		return; // 渲染失败时保留节点里的纯文本。
	}
	if (holder.childNodes.length > 0) target.replaceChildren(...Array.from(holder.childNodes));
}

function createBoardColumn(grid: HTMLElement, name: string): HTMLElement {
	const col = grid.createDiv({ cls: "easy-quiz-card__board-col" });
	col.createDiv({ cls: "easy-quiz-card__board-head", text: name });
	return col;
}

/** 拆出 `左节点|右节点`。 */

/** Fisher–Yates 打乱，返回新数组（不改动入参）；随机源可注入，便于复现。 */
function shuffle<T>(items: readonly T[], random: () => number = Math.random): T[] {
	const result = [...items];
	for (let i = result.length - 1; i > 0; i--) {
		// `random()` 返回 1 或非有限值时也要夹回合法下标，否则会写出越界位置。
		const j = Math.min(Math.max(0, Math.floor(random() * (i + 1))), i);
		const a = result[i];
		const b = result[j];
		if (a === undefined || b === undefined) continue;
		result[i] = b;
		result[j] = a;
	}
	return result;
}

/**
 * 打乱选择题选项，且结果**可复现**。
 *
 * 种子由「会话种子（可选）+ 题目 id + 题面哈希」派生：同一道题在同一轮里永远得到
 * 同一套顺序，因此复盘重画、切题来回都不会跳位；换一轮或题目被改动后才会重洗。
 * 用内容而不是 `Math.random` 做种，是为了让"打乱"看起来像一个稳定的呈现方式，
 * 而不是每次重画都换一副牌——选项跳位最容易被误读成"答案认错了"。
 */
function shuffleOptionOrder(question: QuizQuestion, seed?: number): AnchoredOption[] {
	const source = `${seed ?? 0}\u0000${question.id}\u0000${question.revNow}`;
	// `contentHash` 是 8 位十六进制字符串，取它的 32 位整数值当种子。
	const derived = Number.parseInt(contentHash(source), 16) >>> 0;
	// 只在可见（有锚点）的选项之间打乱：隐藏项不该影响用户看到的顺序。
	return shuffle(anchoredOptions(question), seededRandom(derived));
}

/**
 * 选择题最终呈现的选项：作者选项（可选打乱）+ 数据块 `distractors` 追加的干扰项。
 *
 * 干扰项只影响呈现，不进入判分：锚点固定为 `~d1`、`~d2`…，字符 `~` 不在解析器允许的
 * 锚点字符集里，因此作者选项与干扰项永远不会撞锚点，正确答案集合也不会包含它们。
 * 选取与插入位置都用同一颗种子派生，复盘重画、切题来回看到的是同一组选项。
 */
function choiceOptions(
	question: QuizQuestion,
	randomize: boolean,
	seed?: number,
	review = false
): AnchoredOption[] {
	const base = randomize ? shuffleOptionOrder(question, seed) : anchoredOptions(question);
	const requested = Math.max(0, Math.floor(question.distractorCount ?? 0));
	const pool = question.distractorPool ?? [];
	if (requested === 0 || pool.length === 0) return base;

	// 与作者选项重复的候选直接跳过，避免同一行出现两个一样的选择。
	const seen = new Set(
		question.options.map((option) => plainText(option.markdown).trim().toLowerCase())
	);
	const candidates: string[] = [];
	for (const candidate of pool) {
		const text = candidate.trim();
		if (text === "") continue;
		const key = plainText(text).trim().toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		candidates.push(text);
	}
	if (candidates.length === 0) return base;

	// 干扰项每次作答后重新抽取：把已作答次数并入种子，回答一次就换一组；
	// 复盘时用"上一次作答时"的次数，保证看到的仍是当时那组选项。
	const attempt = Math.max(0, question.stats.attempts - (review ? 1 : 0));
	const random = seededRandom(
		Number.parseInt(
			contentHash(`${seed ?? 0}\u0000${question.id}\u0000distractors\u0000${attempt}`),
			16
		) >>> 0
	);
	const extras: AnchoredOption[] = shuffle(candidates, random)
		.slice(0, requested)
		.map((text, index) => ({ anchor: `~d${index + 1}`, text, markdown: text }));
	return shuffle([...base, ...extras], random);
}

// ---------------------------------------------------------------------------
// 问答题与提交
// ---------------------------------------------------------------------------
async function renderEssay(
	question: QuizQuestion,
	card: HTMLElement,
	ctx: CardContext,
	component: Component
): Promise<void> {
	// 复盘态：不再要一次自评，只把"参考答案见题面折叠块"的提示摊开。
	if (ctx.reviewOnly === true) {
		void renderSubmit(card, ctx, question, t("card.essay.mastered"), () => null, component);
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
		const answer: UserAnswer = { kind: "essay", result };
		ctx.onSubmitted?.(outcome, answer);
		await renderReview(card, question, ctx, component, answer);
		ctx.onReview?.(outcome);
	};
	passed.addEventListener("click", () => void submitEssay("correct"));
	failed.addEventListener("click", () => void submitEssay("wrong"));
}

async function renderSubmit(
	card: HTMLElement,
	ctx: CardContext,
	question: QuizQuestion,
	label: string,
	collect: () => UserAnswer | null,
	component: Component
): Promise<void> {
	// 刷题窗口的复盘态：不提供提交入口，直接把答案与解析摊开。
	if (ctx.reviewOnly === true) {
		// 解析要异步渲染 Markdown：渲染完再回调，调用方不会在解析还空着时就切走卡片。
		await renderReview(card, question, ctx, component);
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
		ctx.onSubmitted?.(result, answer);
		// 复盘内容由调用方决定：数据块渲染时留在原卡片里，刷题窗口则换成下一题。
		await renderReview(card, question, ctx, component, answer);
		ctx.onReview?.(result);
	}
}

/**
 * 把正确答案摊在题卡下方。
 *
 * 只在提交之后调用：选择题列出正确锚点，填空题给出每空原文，
 * 配对题补画正确连线（见 `renderMatch` 的复盘分支），问答/选择题的解析写在最后。
 */
async function renderReview(
	card: HTMLElement,
	question: QuizQuestion,
	ctx: CardContext,
	component: Component,
	lastAnswer?: UserAnswer
): Promise<void> {
	card.addClass("is-reviewed");
	const box = card.createDiv({ cls: "easy-quiz-card__review" });

	// 先摊"你的作答"，再给正确答案：用户点回来最想确认的是自己刚才填了什么。
	const shown = lastAnswer ?? ctx.lastAnswer;
	if (shown !== undefined) renderUserAnswer(box, question, shown);

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
		// 解析与题面、选项一样是作者写的 Markdown（加粗、斜体、图片、公式…），
		// 因此走同一个渲染器；渲染失败或渲染器为空实现时退回纯文本，解析不会丢。
		const body = note.createDiv({ cls: "easy-quiz-card__review-text markdown-rendered" });
		try {
			await MarkdownRenderer.render(ctx.app, question.explanation, body, ctx.file.path, component);
		} catch {
			body.setText(question.explanation.trim());
		}
		if ((body.textContent ?? "").trim() === "") body.setText(question.explanation.trim());
	}
}

/** 复盘里"你的作答"区域：逐条列出用户当时的答案，并用 ✓/✗ 标出对错。 */
function renderUserAnswer(box: HTMLElement, question: QuizQuestion, answer: UserAnswer): void {
	const lines = userAnswerLines(question, answer);
	const section = box.createDiv({ cls: "easy-quiz-card__review-answer" });
	section.createDiv({ cls: "easy-quiz-card__review-head", text: t("card.review.yourAnswer") });
	if (lines.length === 0) {
		section.createDiv({ cls: "easy-quiz-card__review-empty", text: t("card.review.noAnswer") });
		return;
	}
	const list = section.createEl("ul", { cls: "easy-quiz-card__review-answer-list" });
	for (const line of lines) {
		const item = list.createEl("li", { text: `${line.correct ? "✓" : "✗"} ${line.text}` });
		item.addClass(line.correct ? "is-correct" : "is-wrong");
	}
}

interface UserAnswerLine {
	text: string;
	correct: boolean;
}

/** 把作答内容拆成可读的行；对错按题型分别复算（与判分同一套规则）。 */
function userAnswerLines(question: QuizQuestion, answer: UserAnswer): UserAnswerLine[] {
	switch (answer.kind) {
		case "choice": {
			const expected = answerAnchors(question);
			return answer.anchors.map((anchor) => {
				const option = question.options.find((item) => item.anchor === anchor);
				const text = option ? plainText(option.markdown) : anchor;
				return { text: t("grade.anchorLabel", { anchor, text }), correct: expected.includes(anchor) };
			});
		}
		case "blank": {
			const lines: UserAnswerLine[] = [];
			for (const [index, blank] of question.blanks.entries()) {
				const value = (answer.values[index] ?? "").trim();
				if (value === "") continue;
				lines.push({
					text: t("card.review.blankAnswer", { index: index + 1, value }),
					correct: matchBlank(value, blank.expected, question.blankRules[blank.anchor]),
				});
			}
			if (lines.length === 0) lines.push({ text: t("card.review.noAnswer"), correct: false });
			return lines;
		}
		case "match": {
			const text = new Map<string, string>();
			for (const column of question.board) {
				for (const item of column.items) text.set(item.key, item.text);
			}
			return answer.pairs.map((pair) => ({
				text: `${text.get(pair.left) ?? pair.left} — ${text.get(pair.right) ?? pair.right}`,
				correct: question.boardPairs.some(
					(expected) =>
						(expected.left === pair.left && expected.right === pair.right) ||
						(expected.left === pair.right && expected.right === pair.left)
				),
			}));
		}
		case "essay":
			return [
				{
					text: t(answer.result === "correct" ? "card.review.essayMastered" : "card.review.essayNotMastered"),
					correct: answer.result === "correct",
				},
			];
		default:
			return [];
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
