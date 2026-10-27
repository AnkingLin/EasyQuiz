/**
 * README 素材的"场景"定义。
 *
 * 每个场景都走**真实代码路径**：真正的 `parseQuizFile` 解析夹具、真正的
 * `renderQuizCard` / `PracticeView` / `InsertQuestionModal` 渲染 DOM、
 * 真正的 `styles.css` 提供样式。这里只负责搭一个像 Obsidian 的外壳，
 * 以及把交互（点选项、连线、填空、提交）按用户的操作顺序演一遍。
 *
 * 两个关键约束：
 *
 * 1. **在浏览器里跑，而不是 jsdom。** 配对题的连线依赖真实排版算出的
 *    `getBoundingClientRect()`；jsdom 没有布局引擎，连线会因为拿不到尺寸而画不出来。
 *
 * 2. **场景元素必须挂在文档里再渲染。** `renderMatch` 的 `paint()` 会检查
 *    `board.isConnected`，脱离文档的节点直接跳过绘制。因此 `buildScene` 把内容
 *    直接建在 `#stage` 上，而不是先建好再序列化成字符串插进去——顺带也避免了
 *    `innerHTML` 丢失 `input.value` / `checkbox.checked` 这类 IDL 属性
 *    （它们不进 HTML 序列化，插回文档后表单就变回默认态）。
 */

import * as yaml from "js-yaml";
import { installObsidianDom } from "./dom";
import { EN, FixtureSet, ZH } from "./fixtures";
import { contentHash } from "../../../src/hash";
import { setLanguage } from "../../../src/i18n";
import { parseQuizFile } from "../../../src/parser";
import { EasyQuizHost, PracticeView } from "../../../src/practice-view";
import { GradeResult, UserAnswer } from "../../../src/grade";
import { ParsedQuizFile, QuizQuestion } from "../../../src/types";
import { CardContext, renderQuizCard } from "../../../src/view";
import { InsertQuestionModal } from "../../../src/insert-modal";

installObsidianDom();

/** 解析依赖（js-yaml + 真实题干哈希）。 */
const DEPS = { parseYaml: (source: string) => yaml.load(source), hash: contentHash };

// ---------------------------------------------------------------------------
// 可复现的随机
// ---------------------------------------------------------------------------

/**
 * 用固定种子的 PRNG 顶掉 `Math.random`。
 *
 * 配对题的每一列都会独立打乱，不固定种子的话每次生成的截图都不一样，
 * 素材无法复现、也无法 diff。种子在每个场景开始前重置。
 */
function seedRandom(seed: number): void {
	let state = seed >>> 0;
	Math.random = () => {
		// xorshift32：够随机，而且完全确定。
		state ^= state << 13;
		state >>>= 0;
		state ^= state >>> 17;
		state ^= state << 5;
		state >>>= 0;
		return state / 0x1_0000_0000;
	};
}

// ---------------------------------------------------------------------------
// 场景描述
// ---------------------------------------------------------------------------

/** 一个场景的元信息（不渲染，供生成器列举）。 */
export interface SceneInfo {
	name: string;
	dir: "en" | "zh";
	theme: "light" | "dark";
	width: number;
	/** 同一 group 的帧会合成一张 GIF（按 index 排序）。 */
	group: string | null;
	index: number | null;
	delayMs: number | null;
}

/** 场景清单。`build` 在需要时才执行，因此列举清单非常快。 */
interface SceneSpec extends Omit<SceneInfo, "theme"> {
	theme?: "light" | "dark";
	build: () => Promise<HTMLElement> | HTMLElement;
}

// ---------------------------------------------------------------------------
// 夹具 → 内存里的 vault
// ---------------------------------------------------------------------------

/** 一份题库文件在内存里的样子：够 PracticeView 用。 */
interface MemoryFile {
	path: string;
	basename: string;
	stat: { mtime: number };
}

function memoryFile(fixture: { path: string; mtime: number }): MemoryFile {
	const base = fixture.path.split("/").pop() ?? fixture.path;
	return { path: fixture.path, basename: base.replace(/\.md$/, ""), stat: { mtime: fixture.mtime } };
}

/** 解析一份夹具。 */
function parseFixture(fixture: { source: string; path: string }): ParsedQuizFile {
	return parseQuizFile(fixture.source, fixture.path, {
		blockLanguage: "quiz",
		headingLevels: [2, 2],
		headingMode: "level",
		blankMarker: "highlight",
		deps: DEPS,
	});
}

/** 按题型取第一道题（夹具里每种题型各一道）。取不到就报错，别悄悄出空图。 */
function pickByType(parsed: ParsedQuizFile, type: QuizQuestion["type"]): QuizQuestion {
	const found = parsed.questions.find((item) => item.ok && item.type === type);
	if (found === undefined) throw new Error(`夹具里没有 ${type} 题`);
	return found;
}

/** 按标题取一道题（用于演示 question / distractors 这类新字段）。 */
function pickByTitle(parsed: ParsedQuizFile, title: string): QuizQuestion {
	const found = parsed.questions.find((item) => item.ok && item.title === title);
	if (found === undefined) throw new Error(`夹具里没有标题为「${title}」的题`);
	return found;
}

/** 一道"结构确实有问题"的题：用来说明降级提示。 */
function brokenQuestion(parsed: ParsedQuizFile): QuizQuestion {
	const found = parsed.questions.find((item) => !item.ok);
	if (found === undefined) throw new Error("夹具里应有一道降级题，用来生成诊断卡片截图");
	return found;
}

// ---------------------------------------------------------------------------
// DOM 小工具
// ---------------------------------------------------------------------------

/** 生成一个元素，带上类名（Obsidian 的 createDiv 已经被装到原型上）。 */
function div(cls?: string): HTMLElement {
	const el = document.createElement("div");
	if (cls !== undefined) el.className = cls;
	return el;
}

/** 跳过若干轮微任务 / 定时器，让异步渲染落地。 */
async function settle(): Promise<void> {
	for (let i = 0; i < 4; i++) await Promise.resolve();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// 渲染一道题卡
// ---------------------------------------------------------------------------

interface CardOptions {
	/** 提交前先选中这些选项锚点。 */
	select?: string[];
	/** 提交前在这些空位里填内容（按空位顺序）。 */
	blanks?: string[];
	/** 配对题：提交前把正确答案全部连上（连线帧用，可只连前 n 条）。 */
	connect?: number;
	/** 是否走一次真实的提交流程（点提交按钮）。 */
	submit?: boolean;
	/** 判分结果（模拟服务端）；false 表示判错。 */
	correct?: boolean;
	/** 只做复盘渲染，不模拟提交。 */
	reviewOnly?: boolean;
	/** 复盘时要回放的"上一次作答"。 */
	lastAnswer?: UserAnswer;
}

/** 提交用的假服务：判分不落盘，只回一个结果。 */
function fakeService(correct: boolean): CardContext["service"] {
	return {
		submit: async (): Promise<GradeResult> => ({ correct, details: [{ correct }], recorded: [] }),
	} as unknown as CardContext["service"];
}

/** 往空位里写内容，并同步 `data-empty`（真实输入时由 input 事件做这件事）。 */
function typeInto(field: HTMLElement, text: string): void {
	field.textContent = text;
	field.dataset["empty"] = text === "" ? "true" : "false";
}

/** 点一次配对题节点，让连线板真的画出线。 */
function clickNode(card: HTMLElement, column: number, text: string): void {
	const cols = card.querySelectorAll<HTMLElement>(".easy-quiz-card__board-col");
	const col = cols[column];
	if (col === undefined) throw new Error(`配对题没有第 ${column + 1} 列`);
	for (const node of Array.from(col.querySelectorAll<HTMLElement>(".easy-quiz-card__node"))) {
		if ((node.textContent ?? "").trim() === text) {
			node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return;
		}
	}
	throw new Error(`第 ${column + 1} 列里没有条目「${text}」`);
}

/**
 * 渲染一道题并按需演出交互。
 *
 * 返回的题卡**还没有**被放进文档——调用方负责挂载。但为了让配对题能画线，
 * 这里会先把题卡临时挂到 `#stage`（一个已经在文档里、有真实尺寸的容器）上，
 * 演完交互再摘下来交给调用方。挂载期间布局已经完成，`getBoundingClientRect()`
 * 拿得到真实尺寸，连线因此能画对。
 */
async function buildCard(question: QuizQuestion, file: MemoryFile, options: CardOptions): Promise<HTMLElement> {
	seedRandom(20250101);
	const host = div("eq-card-host");

	// 临时挂到工作台上：必须在文档里，否则 renderMatch 的 paint() 会跳过绘制。
	const workbench = document.getElementById("workbench") ?? document.body;
	workbench.appendChild(host);

	try {
		await renderQuizCard(question, {
			// 截图流程不需要真实 App：题卡只用到 workspace / metadataCache，
			// 而这两处都被上面的假 service 与知识点链接的防御性判断绕过了。
			app: {} as CardContext["app"],
			service: fakeService(options.correct !== false),
			file: file as unknown as CardContext["file"],
			el: host,
			blankMarker: "highlight",
			reviewOnly: options.reviewOnly === true,
			lastAnswer: options.lastAnswer,
			onSubmitted: () => undefined,
		});
		await settle();

		const card = host.querySelector<HTMLElement>(".easy-quiz-card");
		if (card === null) throw new Error(`题卡没有渲染出来：${question.id}`);

		// 选择 / 填空 / 连线都走真实事件，复用它们的正常路径。
		if ((options.select ?? []).length > 0) {
			const rows = Array.from(card.querySelectorAll<HTMLElement>(".easy-quiz-card__option"));
			for (const anchor of options.select ?? []) {
				// 按锚点找行，不能按解析顺序的下标找：选项顺序可能被 shuffle 打乱
				// （题目的 `shuffle: true` 或窗口的「打乱顺序」都会），下标对不上就会点错行。
				const row = rows.find((candidate) => candidate.dataset["anchor"] === anchor);
				if (row === undefined) {
					throw new Error(
						`选项 ${anchor} 不存在：解析出 ${question.options.length} 个选项，渲染出 ${rows.length} 个选项行`
					);
				}
				row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			}
		}

		const fields = Array.from(card.querySelectorAll<HTMLElement>(".easy-quiz-card__blank-input"));
		for (const [index, value] of (options.blanks ?? []).entries()) {
			const field = fields[index];
			if (field === undefined) throw new Error(`空位 ${index + 1} 不存在`);
			typeInto(field, value);
		}

		if (options.connect !== undefined) {
			const texts = new Map<string, string>();
			for (const column of question.board) {
				for (const item of column.items) texts.set(item.key, item.text);
			}
			for (const pair of question.boardPairs.slice(0, options.connect)) {
				clickNode(card, 0, texts.get(pair.left) ?? pair.left);
				clickNode(card, 1, texts.get(pair.right) ?? pair.right);
			}
			await settle();
		}

		if (options.submit === true) {
			const submit = card.querySelector<HTMLButtonElement>(".easy-quiz-card__actions button.mod-cta");
			if (submit === null) throw new Error(`题卡没有提交按钮：${question.id}`);
			submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await settle();
			await settle();
		}
	} finally {
		// 交回给调用方之前先摘下来，避免工作台上堆满半成品。
		host.remove();
	}

	return host;
}

// ---------------------------------------------------------------------------
// 外壳
// ---------------------------------------------------------------------------

/** 给题卡包一层"阅读视图里的笔记"外壳。 */
function noteFrame(card: HTMLElement, title: string): HTMLElement {
	const note = div("eq-note");
	const head = div("eq-note__head");
	const label = div("eq-note__title");
	label.textContent = title;
	const badge = div("eq-note__badge");
	badge.textContent = "Reading view";
	head.append(label, badge);
	const body = div("eq-note__body");
	body.appendChild(card);
	note.append(head, body);
	return note;
}

/** 通用的"窗口"外壳（侧边栏 / 对话框都用它）。 */
function windowFrame(title: string, inner: HTMLElement, cls = ""): HTMLElement {
	const win = div(`eq-window${cls === "" ? "" : ` ${cls}`}`);
	const bar = div("eq-window__titlebar");
	bar.appendChild(div("eq-window__dot"));
	bar.appendChild(div("eq-window__dot"));
	const label = div("eq-window__title");
	label.textContent = title;
	bar.appendChild(label);
	const body = div("eq-window__body");
	body.appendChild(inner);
	win.append(bar, body);
	return win;
}

/** 把左侧 Markdown 源码与右侧题卡并排，解释"源码长什么样 → 界面长什么样"。 */
function sourceAndCard(source: string, card: HTMLElement, language: "en" | "zh"): HTMLElement {
	const wrap = div("eq-split");

	// 外壳标签跟随场景语言：中文 README 里出现英文标签会很突兀。
	const labels =
		language === "zh"
			? { left: "笔记里的 Markdown", right: "阅读视图里看到的样子" }
			: { left: "Markdown in the note", right: "What you see in reading view" };

	const left = div("eq-split__pane");
	const leftLabel = div("eq-split__label");
	leftLabel.textContent = labels.left;
	const pre = document.createElement("pre");
	pre.className = "eq-split__code";
	const code = document.createElement("code");
	code.textContent = source;
	pre.appendChild(code);
	left.append(leftLabel, pre);

	const right = div("eq-split__pane");
	const rightLabel = div("eq-split__label");
	rightLabel.textContent = labels.right;
	right.append(rightLabel, card);

	wrap.append(left, right);
	return wrap;
}

/** 左"给 AI 的提示"右"AI 写出的题卡"，用同一套 split 外壳。 */
function promptAndCard(prompt: string, card: HTMLElement, language: "en" | "zh"): HTMLElement {
	const wrap = div("eq-split");
	const labels =
		language === "zh"
			? { left: "给 AI 的提示", right: "AI 写出的题卡" }
			: { left: "Prompt to your AI", right: "The card it writes" };

	const left = div("eq-split__pane");
	const leftLabel = div("eq-split__label");
	leftLabel.textContent = labels.left;
	const pre = document.createElement("pre");
	pre.className = "eq-split__code";
	const code = document.createElement("code");
	code.textContent = prompt;
	pre.appendChild(code);
	left.append(leftLabel, pre);

	const right = div("eq-split__pane");
	const rightLabel = div("eq-split__label");
	rightLabel.textContent = labels.right;
	right.append(rightLabel, card);

	wrap.append(left, right);
	return wrap;
}

/** 一道题的源码片段（标题行到数据块结束），用于"源码 ⇄ 卡片"对照。 */
function sourceOf(fixture: { source: string }, question: QuizQuestion): string {
	const lines = fixture.source.split("\n");
	const start = question.line;
	const end = question.blockLine === null ? lines.length : question.blockLine + 4;
	return lines.slice(start, Math.min(end + 1, lines.length)).join("\n").trim();
}

// ---------------------------------------------------------------------------
// 刷题窗口
// ---------------------------------------------------------------------------

/** 构造一个能跑 `PracticeView` 的宿主；解析结果由真实解析器产出。 */
function buildHost(set: FixtureSet): EasyQuizHost {
	const parsedAt = new Map<string, ParsedQuizFile>();
	const files: MemoryFile[] = [];
	for (const fixture of set.vault) {
		parsedAt.set(fixture.path, parseFixture(fixture));
		files.push(memoryFile(fixture));
	}

	const service = {
		listQuizFiles: () => files,
		parseFile: async (file: MemoryFile) => {
			const parsed = parsedAt.get(file.path);
			if (parsed === undefined) throw new Error(`缺少解析结果：${file.path}`);
			return parsed;
		},
		fileAtPath: (path: string) => files.find((file) => file.path === path) ?? null,
		isQuizFile: () => true,
		updateSettings: () => undefined,
		submit: async (): Promise<GradeResult> => ({ correct: true, details: [{ correct: true }], recorded: [] }),
	};

	return {
		settings: {
			language: set.language,
			blockLanguage: "quiz",
			headingLevels: [2, 2],
			headingMode: "level",
			blankMarker: "highlight",
			pathGlobs: [],
			historyLimit: 10,
			writeBackEnabled: true,
		},
		service: service as unknown as EasyQuizHost["service"],
	};
}

/**
 * 打开刷题窗口并走到指定页面。
 *
 * `view.contentEl` 会先挂到工作台上：窗口内部同样有依赖布局的分支
 * （进度条、题卡尺寸），脱离文档渲染不可靠。
 */
async function buildPracticeView(set: FixtureSet, step: { page: 0 | 1 | 2; pick?: string[] }): Promise<HTMLElement> {
	seedRandom(20250101);
	const view = new PracticeView({ app: {} } as never, buildHost(set), () => undefined);

	const workbench = document.getElementById("workbench") ?? document.body;
	workbench.appendChild(view.contentEl);
	try {
		await view.activate();
		await settle();

		const root = view.contentEl;
		for (const path of step.pick ?? []) {
			const box = root.querySelector<HTMLInputElement>(`input[data-action='pick-file'][data-path='${path}']`);
			if (box === null) throw new Error(`题库列表里没有勾选框：${path}`);
			box.checked = true;
			box.dispatchEvent(new Event("change", { bubbles: true }));
		}
		await settle();

		if (step.page >= 1) {
			const start = root.querySelector<HTMLButtonElement>("button[data-action='to-picker']");
			if (start === null) throw new Error("缺少「开始设置」按钮");
			start.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await settle();
			await settle();
		}

		if (step.page >= 2) {
			const begin = root.querySelector<HTMLButtonElement>("button[data-action='start-session']");
			if (begin === null) throw new Error("缺少「开始刷题」按钮");
			begin.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			await settle();
			await settle();

			/*
			 * 答一题再翻到下一题。
			 *
			 * 只答不翻的话画面自相矛盾：进度行会说"已答 1"，而题卡角标仍写着
			 * "未作答"（角标取自文件里的记录，本轮提交后不会就地刷新）。
			 * 翻到下一题之后两者都成立：进度记的是本轮，新题卡确实还没答过。
			 */
			const submit = root.querySelector<HTMLButtonElement>(".easy-quiz-card__actions button.mod-cta");
			if (submit !== null) {
				root.querySelector<HTMLElement>(".easy-quiz-card__option")?.dispatchEvent(
					new MouseEvent("click", { bubbles: true })
				);
				submit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
				await settle();
				await settle();

				const next = root.querySelector<HTMLButtonElement>("button[data-action='next-question']");
				if (next !== null) {
					next.dispatchEvent(new MouseEvent("click", { bubbles: true }));
					await settle();
					await settle();
				}
			}
		}

		// 窗口自带 padding 会和外框打架，交给外壳（shell.css）控制。
		root.addClass("eq-sidebar-host");
	} finally {
		view.contentEl.remove();
	}

	return view.contentEl;
}

/** 「插入题目」对话框：内容区在文档里渲染完再交出去。 */
function buildInsertModal(set: FixtureSet): HTMLElement {
	seedRandom(20250101);
	// 对话框只在插入时用得到 vault，截图流程不需要真实实现。
	const app = { vault: { getAbstractFileByPath: () => null } };
	const modal = new InsertQuestionModal(app as never, {
		headingLevel: 2,
		blockLanguage: "quiz",
		blankMarker: "highlight",
		onSubmit: () => undefined,
	});

	const workbench = document.getElementById("workbench") ?? document.body;
	workbench.appendChild(modal.containerEl);
	try {
		modal.open();
	} finally {
		modal.containerEl.remove();
	}
	void set;
	return modal.contentEl;
}

// ---------------------------------------------------------------------------
// 场景清单
// ---------------------------------------------------------------------------

/** 卡片场景的通用尺寸。 */
const CARD_WIDTH = 760;

/** 一个语言下的全部静态场景。 */
function staticScenes(set: FixtureSet): SceneSpec[] {
	const tag = set.dir;
	const specs: SceneSpec[] = [];

	/** 注册一道题卡场景。 */
	const card = (
		name: string,
		type: QuizQuestion["type"] | "broken",
		options: CardOptions,
		theme: "light" | "dark" = "light"
	): void => {
		specs.push({
			name,
			dir: tag,
			width: CARD_WIDTH,
			theme,
			group: null,
			index: null,
			delayMs: null,
			build: async () => {
				setLanguage(set.language);
				const parsed = parseFixture(set.cards);
				const question = type === "broken" ? brokenQuestion(parsed) : pickByType(parsed, type);
				const built = await buildCard(question, memoryFile(set.cards), options);
				return noteFrame(built, set.cards.path);
			},
		});
	};

	// 源码 ⇄ 卡片对照：回答"题目到底怎么写"。
	specs.push({
		name: "card-anatomy",
		dir: tag,
		width: 1080,
		theme: "light",
		group: null,
		index: null,
		delayMs: null,
		build: async () => {
			setLanguage(set.language);
			const parsed = parseFixture(set.cards);
			const question = pickByType(parsed, "single");
			const built = await buildCard(question, memoryFile(set.cards), {
				reviewOnly: true,
				lastAnswer: { kind: "choice", anchors: ["c"] },
			});
			return sourceAndCard(sourceOf(set.cards, question), built, set.language);
		},
	});

	card("card-single", "single", { reviewOnly: true, lastAnswer: { kind: "choice", anchors: ["c"] } });
	card(
		"card-single-dark",
		"single",
		{ reviewOnly: true, lastAnswer: { kind: "choice", anchors: ["c"] } },
		"dark"
	);
	card("card-multi", "multi", { reviewOnly: true, lastAnswer: { kind: "choice", anchors: ["a"] } });
	card("card-match", "match", { reviewOnly: true });
	card("card-blank", "blank", { reviewOnly: true });
	card("card-essay", "essay", {});
	card("card-diagnostic", "broken", {});

	// 新增字段：question 覆盖题面 + distractors 追加干扰项。
	specs.push({
		name: "card-distractors",
		dir: tag,
		width: CARD_WIDTH,
		theme: "light",
		group: null,
		index: null,
		delayMs: null,
		build: async () => {
			setLanguage(set.language);
			const parsed = parseFixture(set.cards);
			const question = pickByTitle(
				parsed,
				set.language === "zh" ? "HTTPS 的默认端口是多少？" : "What is the default port for HTTPS?"
			);
			const built = await buildCard(question, memoryFile(set.cards), {});
			return noteFrame(built, set.cards.path);
		},
	});

	// AI Skill：左边是给 AI 的提示，右边是它按 SKILL.md 写出的题卡。
	specs.push({
		name: "ai-authoring",
		dir: tag,
		width: 1160,
		theme: "light",
		group: null,
		index: null,
		delayMs: null,
		build: async () => {
			setLanguage(set.language);
			const parsed = parseFixture(set.cards);
			const question = pickByTitle(
				parsed,
				set.language === "zh" ? "HTTPS 的默认端口是多少？" : "What is the default port for HTTPS?"
			);
			const built = await buildCard(question, memoryFile(set.cards), {});
			const prompt =
				set.language === "zh"
					? [
						"按 skills/easyquiz-authoring/SKILL.md 给下面的笔记补一道单选题：",
						"",
						"文件：题库/计算机网络/第 5 章.md",
						"题干：浏览器打开 https://example.com 时默认连哪个端口",
						"选项：80 / 443 / 22",
						"用 question 字段写完整题干",
						"用 distractors 追加 2 个干扰端口（候选 8080、3000、8443）",
						"答案 443，解析一句话；不要写 stats/history",
					].join("\n")
					: [
						"Add one single-choice question to the note below, following skills/easyquiz-authoring/SKILL.md:",
						"",
						"file: Computer Networks/Chapter 5.md",
						"stem: which port does https://example.com use by default?",
						"options: 80 / 443 / 22",
						"put the full stem in the question field",
						"add 2 decoy ports with distractors (candidates 8080, 3000, 8443)",
						"answer 443, one-sentence explanation, no stats/history",
					].join("\n");
			return promptAndCard(prompt, built, set.language);
		},
	});

	// 刷题窗口的三个页面。
	const pick = set.vault.slice(0, 2).map((fixture) => fixture.path);
	const window = (name: string, page: 0 | 1 | 2): void => {
		specs.push({
			name,
			dir: tag,
			width: 520,
			theme: "light",
			group: null,
			index: null,
			delayMs: null,
			build: async () => {
				setLanguage(set.language);
				const root = await buildPracticeView(set, { page, pick });
				return windowFrame("EasyQuiz", root, "eq-window--sidebar");
			},
		});
	};
	window("window-list", 0);
	window("window-picker", 1);
	window("window-practice", 2);

	// 插入题目对话框。
	specs.push({
		name: "modal-insert",
		dir: tag,
		width: 560,
		theme: "light",
		group: null,
		index: null,
		delayMs: null,
		build: () => {
			setLanguage(set.language);
			const content = buildInsertModal(set);
			return windowFrame(set.language === "zh" ? "插入题目" : "Insert question", content, "eq-window--modal");
		},
	});

	return specs;
}

/**
 * 动画帧。
 *
 * 两段动画都只演"用户手能做到的事"：
 *   - 配对题：一条一条点出连线；
 *   - 填空题：一个空一个空地敲进去。
 * 帧由真实渲染器产出，所以 GIF 里看到的就是插件真实的行为。
 */
function animatedScenes(set: FixtureSet): SceneSpec[] {
	const tag = set.dir;
	const specs: SceneSpec[] = [];
	const note = async (question: QuizQuestion, options: CardOptions): Promise<HTMLElement> => {
		setLanguage(set.language);
		const built = await buildCard(question, memoryFile(set.cards), options);
		return noteFrame(built, set.cards.path);
	};

	// ---------------------------------------------------------------- 配对题
	specs.push({
		name: "gif-match",
		dir: tag,
		width: CARD_WIDTH,
		theme: "light",
		group: "gif-match",
		index: 0,
		delayMs: 900,
		build: async () => note(pickByType(parseFixture(set.cards), "match"), { connect: 0 }),
	});
	// 一条一条连接：第 n 帧连上前 n 条正确连线。
	const matchPairs = parseFixture(set.cards).questions.find((item) => item.type === "match")?.boardPairs.length ?? 0;
	for (let step = 1; step <= matchPairs; step++) {
		specs.push({
			name: "gif-match",
			dir: tag,
			width: CARD_WIDTH,
			theme: "light",
			group: "gif-match",
			index: step,
			delayMs: 700,
			build: async () => note(pickByType(parseFixture(set.cards), "match"), { connect: step }),
		});
	}

	// ---------------------------------------------------------------- 填空题
	// 逐字敲入：每一帧都比上一帧多一个字（第二个空接着第一个空之后敲）。
	const blankQuestion = pickByType(parseFixture(set.cards), "blank");
	const answers = blankQuestion.blanks.map((blank) => blank.expected);
	const frames: string[][] = [];
	for (const [index, answer] of answers.entries()) {
		for (let length = 0; length <= answer.length; length++) {
			frames.push(
				answers.map((text, position) =>
					position < index ? text : position === index ? answer.slice(0, length) : ""
				)
			);
		}
	}
	for (const [step, values] of frames.entries()) {
		specs.push({
			name: "gif-blank",
			dir: tag,
			width: CARD_WIDTH,
			theme: "light",
			group: "gif-blank",
			index: step,
			delayMs: 380,
			build: async () => note(pickByType(parseFixture(set.cards), "blank"), { blanks: values }),
		});
	}

	return specs;
}

const SPECS: SceneSpec[] = [...staticScenes(EN), ...staticScenes(ZH), ...animatedScenes(EN), ...animatedScenes(ZH)];

/** 场景清单（不含构建函数，可安全序列化）。 */
export function sceneManifest(): SceneInfo[] {
	return SPECS.map((spec) => ({
		name: spec.name,
		dir: spec.dir,
		theme: spec.theme ?? "light",
		width: spec.width,
		group: spec.group,
		index: spec.index,
		delayMs: spec.delayMs,
	}));
}

/**
 * 构建某个场景。
 *
 * 同一个 `name` + `dir` 可能对应多帧（动画），因此必须同时用 `index` 区分：
 * 只按名字找会永远命中的是第一帧，动画就会退化成一张静止的图。
 */
export async function buildScene(
	name: string,
	dir: string,
	index: number
): Promise<{ info: SceneInfo; element: HTMLElement } | undefined> {
	const spec = SPECS.find(
		(item) =>
			item.name === name && item.dir === dir && (item.index ?? 0) === (item.group === null ? 0 : index)
	);
	if (spec === undefined) return undefined;
	const element = await spec.build();
	return {
		info: {
			name: spec.name,
			dir: spec.dir,
			theme: spec.theme ?? "light",
			width: spec.width,
			group: spec.group,
			index: spec.index,
			delayMs: spec.delayMs,
		},
		element,
	};
}
