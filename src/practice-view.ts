/**
 * 刷题窗口：一个包含三个页面的 ItemView。
 *
 * 1. **题库列表**：按文件路径列出 vault 里所有题库文件，逐份给出题量、
 *    可作答数、需要修正的提示以及正确率——"文件路径 + 数据"在同一行里看完。
 * 2. **刷题设置**：选定文件后挑题型、错误率与抽题方式（顺序 / 定量随机 / 只刷错题），
 *    并在开始前就把"这一轮会有多少题"算给用户看。
 * 3. **刷题**：一次只呈现一道题，提交后原地复盘，再用「下一题」推进，走完给出成绩。
 *
 * 分工：抽题、筛选、进度这些纯逻辑都在 `session.ts` 里，本文件只负责把它们
 * 画出来并接上交互。判分与写回仍然走 `QuizService` / `renderQuizCard`，
 * 因此窗口内作答与在笔记里作答写回的是同一份记录。
 */

import { Component, ItemView, Notice, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { MessageKey, t } from "./i18n";
import { typeLabel } from "./labels";
import { QuizService, formatStats, RuntimeSettings } from "./runtime";
import {
	buildSession,
	DEFAULT_SESSION_CONFIG,
	filterQuestions,
	ParsedMap,
	PracticeMode,
	QueueEntry,
	resolveEntry,
	SessionConfig,
	sessionProgress,
	summarizeAll,
	summarizeFile,
	SummaryTotals,
	TYPE_ORDER,
} from "./session";
import { ParsedQuizFile, QuizQuestion, QuizType } from "./types";
import type { GradeResult, UserAnswer } from "./grade";
import { CardContext, renderQuizCard } from "./view";
import { openQuestionSource } from "./source-note";

export const PRACTICE_VIEW_TYPE = "easy-quiz-practice";

/** 顶部三步指示里的步骤名对应的消息键。 */
const STEP_KEYS: readonly MessageKey[] = [
	"practice.step.list",
	"practice.step.settings",
	"practice.step.practice",
];

/** 模式按钮文案对应的消息键。 */
const MODE_LABEL_KEYS: Record<PracticeMode, MessageKey> = {
	order: "practice.mode.order",
	random: "practice.mode.random",
	wrong: "practice.mode.wrong",
};

const MODE_HINT_KEYS: Record<PracticeMode, MessageKey> = {
	order: "practice.mode.orderHint",
	random: "practice.mode.randomHint",
	wrong: "practice.mode.wrongHint",
};

/** 三个模式按这个顺序出现在按钮组里。 */
const MODES: readonly PracticeMode[] = ["order", "random", "wrong"];

/** 错误率筛选的可选阈值（百分比）；0 表示不限。 */
const ERROR_RATE_STEPS: readonly number[] = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

/** 把任意外来值收敛到下拉框里存在的阈值上（旧工作区状态、手改配置都不会让下拉框变空）。 */
function normalizeErrorRate(value: number): number {
	let best = 0;
	for (const rate of ERROR_RATE_STEPS) {
		if (Math.abs(rate - value) < Math.abs(best - value)) best = rate;
	}
	return best;
}

/** 窗口只要求宿主提供设置与解析服务，因此不必 import 插件类（避免循环依赖）。 */
export interface EasyQuizHost {
	settings: RuntimeSettings;
	service: QuizService;
	/**
	 * 题卡渲染入口。默认就是 `renderQuizCard`（与笔记里渲染的是同一份实现），
	 * 留出这个口子是为了测试能替换掉题卡内部交互，只验证窗口本身的行为。
	 */
	cardRenderer?: (question: QuizQuestion, ctx: CardContext) => Promise<void>;
	/** 题卡上的「关闭提示」：关掉设置里的总开关并保存。 */
	dismissStaleHint?: () => void | Promise<void>;
}

/** 一个题库文件的完整信息（汇总 + 解析结果）。 */
interface FileEntry {
	file: TFile;
	summary: ReturnType<typeof summarizeFile>;
	parsed: ParsedQuizFile | null;
	/** 解析失败时的错误文本。 */
	error: string | null;
}

/** 列表页里的一个文件夹分组：文件夹名 + 其中的文件（已按路径排序）。 */
interface FolderGroup {
	/** `FileSummary.folder`；vault 根为 ""。 */
	folder: string;
	entries: FileEntry[];
}

/** 当前页面：0 题库列表 / 1 刷题设置 / 2 刷题。 */
type Page = 0 | 1 | 2;

export class PracticeView extends ItemView {
	private host: EasyQuizHost;
	private openSettings: () => void;

	/** 当前页面。 */
	private page: Page = 0;
	/** 题库列表的缓存；null 表示还没扫过。 */
	private entries: FileEntry[] | null = null;
	/** 列表页的搜索词：按文件名或路径过滤。 */
	private query = "";
	/** 列表页被折叠的文件夹（键取自 `FileSummary.folder`，vault 根为 ""）。 */
	private folded = new Set<string>();
	/** 设置页里选中的文件路径。 */
	private picked: string[] = [];
	/** 设置页里的抽题配置。 */
	private config: SessionConfig = { ...DEFAULT_SESSION_CONFIG, types: [] };
	/** 选中文件的解析结果（键为路径）。 */
	private parsedByPath: ParsedMap = new Map<string, ParsedQuizFile>();
	/** 队列项对应的文件对象，渲染题面时用它解析相对链接。 */
	private fileAt = new Map<string, TFile>();
	/** 数据可能已变化（文件被编辑或本窗口写过记录）：下次渲染前重新解析。 */
	private stale = false;
	/** 上次扫描时的文件指纹（路径 + 修改时间）；用来判断列表缓存是否还能直接用。 */
	private scanSignature: string | null = null;
	/** 正在进行的扫描；重复进入列表页时共用同一个结果。 */
	private scanInFlight: Promise<FileEntry[]> | null = null;
	/** 被改动过的题库文件；列表刷新时只重解析它们。 */
	private dirtyPaths = new Set<string>();
	/** 列表页是否已经画出完整结构（工具条 / 汇总 / 清单 / 页脚）。 */
	private listPainted = false;
	/** 汇总行；刷新列表时就地改文字，不重建整页。 */
	private totalsEl: HTMLElement | null = null;
	/** 后台刷新列表的任务；新的刷新请求合并成一次。 */
	private listRefreshTask: Promise<void> | null = null;
	private listRefreshQueued = false;
	/** 列表还没画好时收到刷新请求：等这一轮渲染结束后补一次。 */
	private listRefreshDeferred = false;

	/** 视图已经打开（`onOpen` 跑过）。 */
	private opened = false;
	/** 视图已关闭；异步渲染不应再往 `contentEl` 里写。 */
	private closed = false;
	/** 是否已经画过至少一次页面内容。 */
	private initialRenderDone = false;
	/** `onOpen` 之后等缓存状态的那一拍；收不到 `setState` 时兜底渲染。 */
	private initialFallback: number | null = null;
	/** 串行化的整页渲染：重画过程中再来的请求合并到当前这轮之后。 */
	private renderTask: Promise<void> | null = null;
	private renderQueued = false;
	/** 上一次整页渲染对应的页面；同页重画时保留滚动位置。 */
	private renderedPage: Page | null = null;

	/** 刷题会话。 */
	private queue: QueueEntry[] = [];
	private cursor = 0;
	/** 逐题结果；null 表示还没作答。长度与 `queue` 对齐。 */
	private results: (boolean | null)[] = [];
	/** 逐题的作答内容；切回已答题目时用它回放"你选了什么/填了什么"。 */
	private answers: (UserAnswer | null)[] = [];
	/** 已提交、正在复盘。 */
	private reviewing = false;
	/** 本轮已结算。 */
	private finished = false;
	/** 本轮至少写回过一次记录。 */
	private dirty = false;
	/** 本轮的选项打乱种子：同一轮里保持稳定，重开一轮才换。 */
	private sessionSeed = 0;
	/** 题卡自身的资源回收（例如配对题的尺寸观察者）。 */
	private cardCleanups: (() => void)[] = [];
	/**
	 * 题卡注册给本视图的 Markdown 子组件。
	 *
	 * 题面、选项、解析里的图片与嵌入块要靠 `MarkdownRenderChild` 的加载才会挂上内容；
	 * 卡片被换掉时必须一起卸载，否则换一道题就多留下一份监听。
	 */
	private cardComponents: Component[] = [];

	/** 页面骨架。 */
	private rootEl: HTMLElement | null = null;
	private navEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	/** 刷题页里需要原地更新的部分：只重画它们，避免整页重画。 */
	private cardHost: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private startEl: HTMLButtonElement | null = null;
	/** 列表页底部操作条上的"已选几份"文案。 */
	private footerTextEl: HTMLElement | null = null;
	/** 列表页"匹配到几份"的说明；没搜索时隐藏。 */
	private matchedEl: HTMLElement | null = null;

	constructor(leaf: WorkspaceLeaf, host: EasyQuizHost, openSettings: () => void) {
		super(leaf);
		this.host = host;
		this.openSettings = openSettings;
	}

	getViewType(): string {
		return PRACTICE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return t("practice.title");
	}

	getIcon(): string {
		return "graduation-cap";
	}

	/**
	 * 恢复工作区时保存用户走到哪一步；抽题队列本身不持久化，
	 * 刷新后重新设置一轮即可（题目数据始终以笔记为准）。
	 */
	getState(): Record<string, unknown> {
		return {
			page: this.page,
			picked: [...this.picked],
			mode: this.config.mode,
			randomCount: this.config.randomCount,
			minErrorRate: this.config.minErrorRate,
			// 搜索词与折叠状态属于"用户怎么看这份清单"，重建工作区时应当保留。
			query: this.query,
			folded: [...this.folded],
		};
	}

	async setState(state: unknown, _result: unknown): Promise<void> {
		const changed = this.applyState(state);
		this.clearInitialFallback();
		// Obsidian 正常是 `onOpen` 在前、`setState` 在后；万一顺序反过来，等视图打开再画。
		if (!this.opened) return;
		/*
		 * 首屏必须等缓存状态就位后再画。
		 *
		 * `WorkspaceLeaf.setViewState` 的固定顺序是先 `open()`（触发 `onOpen`）、
		 * 再 `setState()`。此前 `onOpen` 里直接渲染列表，随后 `setState` 只改内部页码
		 * 而不重画：用户看到的是题库列表，`this.page` 却已经是设置页/刷题页，
		 * 列表上的按钮于是按别的页面响应（例如点「全选」会跳到刷题设置）。
		 */
		if (!this.initialRenderDone || changed) await this.render();
	}

	/** 把视图状态读进字段，返回是否有任何一项真的变了。 */
	private applyState(state: unknown): boolean {
		if (typeof state !== "object" || state === null) return false;
		const data = state as Record<string, unknown>;
		let changed = false;

		const page = data["page"];
		if (page === 0 || page === 1 || page === 2) {
			if (this.page !== page) {
				this.page = page;
				changed = true;
			}
		}

		const picked = data["picked"];
		if (Array.isArray(picked)) {
			const next = picked.filter((item): item is string => typeof item === "string");
			if (!sameStrings(this.picked, next)) {
				this.picked = next;
				changed = true;
			}
		}

		const query = data["query"];
		if (typeof query === "string" && query !== this.query) {
			this.query = query;
			changed = true;
		}

		const folded = data["folded"];
		if (Array.isArray(folded)) {
			const next = new Set(folded.filter((item): item is string => typeof item === "string"));
			if (!sameSet(this.folded, next)) {
				this.folded = next;
				changed = true;
			}
		}

		const mode = data["mode"];
		if ((mode === "order" || mode === "random" || mode === "wrong") && mode !== this.config.mode) {
			this.config.mode = mode;
			changed = true;
		}

		const count = data["randomCount"];
		if (typeof count === "number" && Number.isFinite(count)) {
			const next = Math.max(0, Math.round(count));
			if (next !== this.config.randomCount) {
				this.config.randomCount = next;
				changed = true;
			}
		}

		const minErrorRate = data["minErrorRate"];
		if (typeof minErrorRate === "number" && Number.isFinite(minErrorRate)) {
			const next = normalizeErrorRate(Math.min(100, Math.max(0, minErrorRate)));
			if (next !== this.config.minErrorRate) {
				this.config.minErrorRate = next;
				changed = true;
			}
		}

		// 队列没有持久化：恢复到刷题页时退回设置页，避免出现空白的第三页。
		// 但视图里已经有一轮在进行时不能踢走它——`setViewState` 也会给已打开的
		// 视图补一次状态（例如命令再次聚焦窗口），那时队列是活的。
		if (this.page === 2 && this.queue.length === 0) {
			this.page = this.picked.length > 0 ? 1 : 0;
			changed = true;
		}
		return changed;
	}

	/** 命令/丝带打开窗口时调用：回到题库列表并核对数据。 */
	async activate(): Promise<void> {
		this.clearInitialFallback();
		const wasList = this.page === 0 && this.initialRenderDone;
		this.page = 0;
		if (wasList) {
			// 已经停在列表：只核对并就地更新数据，不重建工具条与滚动位置。
			await this.refreshList();
			return;
		}
		await this.render();
	}

	/**
	 * 直接打开某个题库文件的刷题设置页（文件浏览器菜单的入口）。
	 *
	 * 只把这份文件设为选中，其余勾选一律丢弃：从菜单点进来时用户要刷的
	 * 就是这一个题库，上一轮留在窗口里的选择只会带来困惑。
	 */
	async openPickerFor(path: string): Promise<void> {
		this.picked = [path];
		this.page = 1;
		this.markStale(path);
		await this.render();
	}

	/**
	 * 命令「刷这个题库」：立即用指定文件开一轮练习，跳过刷题设置页。
	 *
	 * 沿用窗口里上一次的抽题方式与题型筛选；只把选中文件换成这一个。
	 */
	async practiceFile(path: string): Promise<void> {
		this.picked = [path];
		this.page = 1;
		this.markStale(path);
		await this.loadParsed(true);
		await this.startSession();
	}

	async onOpen(): Promise<void> {
		this.opened = true;
		this.closed = false;
		this.initialRenderDone = false;
		this.renderedPage = null;

		// 从别的标签页切回来时文件可能已经被改过。列表页先核对一次缓存指纹，
		// 过期就自己重扫，而不是让用户再点一次「重新扫描」才能看到正常的列表。
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf !== this.leaf) return;
				void this.refreshOnActivate();
			})
		);
		// 启动时 Obsidian 先恢复布局、再建元数据缓存：那一刻所有笔记都还没有
		// frontmatter，整个 vault 会被当成空库。缓存建好后自己再核对一次。
		const cache = this.app.metadataCache;
		if (typeof cache?.on === "function") {
			this.registerEvent(
				cache.on("resolved", () => {
					if (this.page !== 0) return;
					// 首屏可能恰好还在扫描：`refreshList` 会把它记成一次延后刷新。
					void this.refreshList();
				})
			);
		}

		/*
		 * 先搭骨架、再等缓存状态。
		 *
		 * `WorkspaceLeaf.setViewState` 固定先 `open()`（触发 `onOpen`）再 `setState()`；
		 * 若在这里直接渲染，列表会先按第一页画一遍，随后 `setState` 只改内部页码、
		 * 不重画 DOM，用户看到的页面与按钮实际作用的页面就会错位。
		 * 因此首屏内容一律由 `setState` 驱动，这里只放一块不会闪白的占位。
		 */
		const body = this.ensureShell();
		this.renderSteps();
		body.createDiv({ cls: "easy-quiz-practice__loading", text: t("practice.loading") });

		// 正常路径下 `setState` 会在当前微任务之后立即到达并清掉这颗定时器。
		// 兜底：万一视图是被直接 `open()` 出来的（没有缓存状态可恢复），也要自己画出来。
		this.initialFallback = window.setTimeout(() => {
			this.initialFallback = null;
			if (this.closed || this.initialRenderDone) return;
			void this.render();
		}, 0);
	}

	/** 本视图重新成为活动标签页时调用：只在列表页核对缓存，刷题页不打扰当前进度。 */
	private async refreshOnActivate(): Promise<void> {
		if (this.page !== 0) return;
		await this.refreshList();
	}

	/** 当前题库文件集合的指纹：路径 + 修改时间。文件增删或编辑都会让它变化。 */
	private currentSignature(): string {
		return fileSignature(this.host.service.listQuizFiles());
	}

	async onClose(): Promise<void> {
		this.closed = true;
		this.opened = false;
		this.clearInitialFallback();
		this.releaseCard();
		this.contentEl.empty();
		this.rootEl = null;
		this.navEl = null;
		this.bodyEl = null;
		this.cardHost = null;
		this.progressEl = null;
		this.countEl = null;
		this.startEl = null;
		this.footerTextEl = null;
		this.matchedEl = null;
		this.totalsEl = null;
		this.listPainted = false;
		this.listRefreshDeferred = false;
		this.renderedPage = null;
	}

	/** 清掉 `onOpen` 里那颗"等状态"的兜底定时器。 */
	private clearInitialFallback(): void {
		if (this.initialFallback === null) return;
		window.clearTimeout(this.initialFallback);
		this.initialFallback = null;
	}

	/**
	 * 宿主声明题库数据可能已变化：下次渲染前重新解析。
	 *
	 * 传入具体路径时只标记该文件（`vault` 事件知道改的是哪一份），列表刷新因此
	 * 只需重解析它；不传路径表示整份缓存都不可信（例如解析设置变了）。
	 */
	markStale(path?: string): void {
		this.stale = true;
		if (typeof path === "string" && path !== "") {
			this.dirtyPaths.add(path);
			return;
		}
		this.entries = null;
		this.dirtyPaths.clear();
	}

	// -----------------------------------------------------------------------
	// 页面骨架
	// -----------------------------------------------------------------------

	/** 释放题卡自己的资源（配对题的观察者会在卡片被换掉后一直看着旧节点）。 */
	private releaseCard(): void {
		for (const cleanup of this.cardCleanups.splice(0)) cleanup();
		for (const child of this.cardComponents.splice(0)) this.removeChild(child);
	}

	/**
	 * 重画整个窗口；页面切换、数据刷新都走这一个入口。
	 *
	 * 同一时刻只跑一轮：重画过程中再来的请求合并成"结束前再来一次"。启动时
	 * 状态恢复、元数据就绪、切回标签页可能在同一帧里先后要求重画，若各自清空
	 * `contentEl`，就会看到空白闪动，甚至把用户刚点出来的页面冲掉。
	 */
	render(): Promise<void> {
		this.renderQueued = true;
		if (this.renderTask === null) {
			this.renderTask = (async () => {
				try {
					while (this.renderQueued) {
						this.renderQueued = false;
						await this.performRender();
					}
				} finally {
					this.renderTask = null;
				}
			})();
		}
		return this.renderTask;
	}

	private async performRender(): Promise<void> {
		if (this.closed) return;

		// 每次重画都重新取一遍设置，设置页改动后无需重开窗口。
		this.host.service.updateSettings(this.host.settings);

		const body = this.ensureShell();
		const pageChanged = this.renderedPage !== this.page;
		this.releaseCard();
		body.empty();
		this.clearPageRefs();
		this.listPainted = false;
		this.renderedPage = this.page;
		this.renderSteps();
		// 换页时回到顶部；同页重画（语言切换等）保留读者的滚动位置。
		if (pageChanged && this.rootEl !== null) this.rootEl.scrollTop = 0;

		try {
			if (this.page === 0) await this.renderList();
			else if (this.page === 1) await this.renderPicker();
			else await this.renderSession();
		} catch (error) {
			// 窗口级异常不该把整块工作区变成空白：就地报错，用户还能切回列表重试。
			const target = this.bodyEl ?? this.rootEl;
			target?.createDiv({
				cls: "easy-quiz-practice__error",
				text: t("practice.renderFailed", {
					error: error instanceof Error ? error.message : String(error),
				}),
			});
		}
		this.initialRenderDone = true;
		// 首屏渲染期间收到过"数据可能已变"的通知（元数据建好、切回标签页）：
		// 现在页面已经在了，补做一次就地刷新，避免首屏停在半旧的列表上。
		if (this.listRefreshDeferred) {
			this.listRefreshDeferred = false;
			try {
				await this.refreshList();
			} catch (error) {
				// 补做刷新失败不该让首屏渲染变成一次 rejected promise；数据仍会在下次刷新时重试。
				console.error("EasyQuiz: could not refresh the practice list", error);
			}
		}
	}

	/**
	 * 保证窗口骨架存在，返回页面内容的容器。
	 *
	 * 骨架只建一次：后续重画只换 `body` 里的内容，步骤条、滚动容器和主题背景
	 * 都保持原节点，避免整页重建时的高度跳变与滚动位置丢失。
	 */
	private ensureShell(): HTMLElement {
		let root = this.rootEl;
		if (root === null || root.parentElement !== this.contentEl) {
			this.contentEl.empty();
			root = this.contentEl.createDiv({ cls: "easy-quiz-practice" });
			this.rootEl = root;
			this.navEl = root.createDiv({ cls: "easy-quiz-practice__steps" });
			this.bodyEl = root.createDiv({ cls: "easy-quiz-practice__body" });
		}
		const body = this.bodyEl ?? root.createDiv({ cls: "easy-quiz-practice__body" });
		this.bodyEl = body;
		return body;
	}

	/** 页面级引用只对当前这一屏有效，换页或重画时必须一起清掉。 */
	private clearPageRefs(): void {
		this.progressEl = null;
		this.cardHost = null;
		this.countEl = null;
		this.startEl = null;
		this.footerTextEl = null;
		this.matchedEl = null;
		this.totalsEl = null;
	}

	/** 顶部的三步指示，同时充当"往回走一步"的入口。 */
	private renderSteps(): void {
		const nav = this.navEl;
		if (nav === null) return;
		nav.empty();

		for (const [index, labelKey] of STEP_KEYS.entries()) {
			const current = index === this.page;
			const step = nav.createDiv({
				cls: `easy-quiz-practice__step${current ? " is-current" : ""}${index < this.page ? " is-done" : ""}`,
			});
			step.createSpan({ cls: "easy-quiz-practice__step-no", text: String(index + 1) });
			step.createSpan({ cls: "easy-quiz-practice__step-label", text: t(labelKey) });

			// 只允许往回走：往前跳会跳过必填的选择。
			if (index < this.page) {
				step.addClass("is-link");
				step.dataset["action"] = "goto-step";
				step.dataset["step"] = String(index);
				step.addEventListener("click", () => {
					this.releaseCard();
					this.page = index === 0 ? 0 : 1;
					void this.render();
				});
			}
		}
	}

	/** 页面主标题与说明。 */
	private heading(title: string, hint?: string): HTMLElement | null {
		const body = this.bodyEl;
		if (body === null) return null;
		const head = body.createDiv({ cls: "easy-quiz-practice__head" });
		head.createEl("h3", { cls: "easy-quiz-practice__title", text: title });
		if (hint !== undefined) head.createDiv({ cls: "easy-quiz-practice__hint", text: hint });
		return head;
	}

	private button(parent: HTMLElement, action: string, text: string, cta = false): HTMLButtonElement {
		const el = parent.createEl("button", { text, cls: cta ? "mod-cta" : undefined });
		el.dataset["action"] = action;
		return el;
	}

	// -----------------------------------------------------------------------
	// 页面 1：题库列表
	// -----------------------------------------------------------------------

	/**
	 * 列表页的过滤结果：命中搜索词的文件，以及它们按文件夹的分组。
	 *
	 * 纯计算，不碰 DOM——搜索、分组、折叠三件事共用这一份结果，
	 * 因此"搜出来的文件"与"勾得上的文件"永远是同一批。
	 */
	private visible(): { matched: FileEntry[]; groups: FolderGroup[] } {
		const entries = this.entries ?? [];
		const needle = this.query.trim().toLowerCase();
		const matched =
			needle === ""
				? entries
				: entries.filter(
						(entry) =>
							entry.file.path.toLowerCase().includes(needle) ||
							entry.file.basename.toLowerCase().includes(needle)
					);

		// 按文件夹收拢，而不是只合并"相邻"的同名文件夹：路径排序会把
		// `题库/a.md`、`题库/a/b.md`、`题库/c.md` 排成 题库 → 题库/a → 题库，
		// 若只看相邻项，同一个文件夹会被拆成两个分组：组标题上的勾选框只能反映
		// 其中一半文件，部分选中时也画不出半选状态。用 Map 收拢后组内仍保持路径顺序。
		const byFolder = new Map<string, FileEntry[]>();
		for (const entry of matched) {
			const folder = entry.summary.folder;
			const bucket = byFolder.get(folder);
			if (bucket === undefined) byFolder.set(folder, [entry]);
			else bucket.push(entry);
		}
		const groups: FolderGroup[] = [...byFolder.entries()]
			// vault 根排在最前，其余按文件夹路径排序，分组顺序因此稳定。
			.sort(([first], [second]) => {
				if (first === second) return 0;
				if (first === "") return -1;
				if (second === "") return 1;
				return first.localeCompare(second);
			})
			.map(([folder, bucket]) => ({ folder, entries: bucket }));
		return { matched, groups };
	}

	/** 文件夹在界面上的显示名；vault 根用一句人话代替空字符串。 */
	private folderLabel(folder: string): string {
		return folder === "" ? t("practice.list.rootFolder") : `/${folder}`;
	}

	/**
	 * 扫描一次题库；启动时两处渲染可能同时要数据，共用同一次扫描，
	 * 免得 140 份题库被解析两遍。
	 */
	private scan(): Promise<FileEntry[]> {
		const running = this.scanInFlight;
		if (running !== null) return running;
		const started = this.runScan();
		this.scanInFlight = started;
		const clear = (): void => {
			if (this.scanInFlight === started) this.scanInFlight = null;
		};
		void started.then(clear, clear);
		return started;
	}

	/**
	 * 扫描 vault 里的题库文件；结果缓存在 `entries` 里。
	 *
	 * 默认按"每份文件的修改时间"做增量：只有新增、删除或改动过的文件会被重新解析，
	 * 其余条目直接复用。设置变更等无法定位到单份文件的情况（`markStale()` 不带路径）
	 * 会先清空 `entries`，于是自然走整库重扫。
	 */
	private async runScan(): Promise<FileEntry[]> {
		const files = await this.quizFiles();
		const signature = fileSignature(files);
		const cached = this.entries;
		// 缓存仍然有效需要同时满足：没被标记过期、没有待重解析的文件，且文件集合与
		// 修改时间都没变。只凭 `stale` 判断会漏掉「窗口在后台时文件被别人改了」的情形。
		if (
			cached !== null &&
			!this.stale &&
			this.dirtyPaths.size === 0 &&
			signature === this.scanSignature
		) {
			return cached;
		}

		// 扫描期间新来的改动不能被这次扫描的完成状态覆盖：先取走，结束时看还有没有剩下的。
		const dirty = new Set(this.dirtyPaths);
		this.dirtyPaths.clear();
		// stale 但没有具体路径 = 解析设置变了：所有条目都不可信。
		const forceAll = this.stale && dirty.size === 0;

		const previous = new Map<string, FileEntry>();
		for (const entry of cached ?? []) previous.set(entry.file.path, entry);

		const entries: FileEntry[] = [];
		let reparsed = 0;
		for (const file of files) {
			const entry = previous.get(file.path);
			// `summary.mtime` 是上一次解析开始时的快照；与当前 mtime 不同就重解析。
			const reusable =
				!forceAll &&
				entry !== undefined &&
				!dirty.has(file.path) &&
				entry.summary.mtime === file.stat.mtime;
			if (reusable) {
				entries.push(entry);
				continue;
			}
			entries.push(await this.parseEntry(file));
			reparsed += 1;
		}

		// 一份都没重解析、文件集合也没变：保留原数组，列表不用重画。
		if (cached !== null && reparsed === 0 && entries.length === cached.length) {
			this.scanSignature = signature;
			if (this.dirtyPaths.size === 0) this.stale = false;
			return cached;
		}

		entries.sort((first, second) => first.file.path.localeCompare(second.file.path));
		this.entries = entries;
		this.scanSignature = signature;
		if (this.dirtyPaths.size === 0) this.stale = false;
		return entries;
	}

	/** 解析一份题库文件；失败只影响它自己那一行，不拖垮整个列表。 */
	private async parseEntry(file: TFile): Promise<FileEntry> {
		// 先记下开始解析时的修改时间：读取/解析期间文件若又被改，下一次扫描还能看出差异。
		const mtime = file.stat.mtime;
		try {
			const parsed = await this.host.service.parseFile(file);
			return {
				file,
				summary: summarizeFile(parsed, file.path, mtime),
				parsed,
				error: null,
			};
		} catch (error) {
			// 单份文件解析失败不能拖垮整个列表：给出错误摘要，题量按 0 计。
			return {
				file,
				summary: summarizeFile(emptyParse(), file.path, mtime),
				parsed: null,
				error: error instanceof Error ? error.message : String(error),
			};
		}
	}

	/**
	 * 当前该扫哪些题库文件。
	 *
	 * 启动时 Obsidian 先恢复布局、再建元数据缓存：那一刻所有笔记都还没有
	 * frontmatter，整个 vault 会被当成空库，列表于是显示"没有题库文件"并且
	 * 不会自己恢复。这里先等缓存就绪（最多 3 秒），再取一次文件列表。
	 */
	private async quizFiles(): Promise<TFile[]> {
		const files = this.host.service.listQuizFiles();
		if (files.length > 0 || !this.metadataPending()) return files;
		await this.awaitMetadata();
		return this.host.service.listQuizFiles();
	}

	/** 元数据缓存看起来还没建好：抽一批笔记，一份都没有缓存。 */
	private metadataPending(): boolean {
		const vault = this.app.vault;
		if (typeof vault?.getMarkdownFiles !== "function") return false;
		const markdown = vault.getMarkdownFiles();
		if (markdown.length === 0) return false;
		return markdown
			.slice(0, 20)
			.every((file) => (this.app.metadataCache?.getFileCache?.(file) ?? null) === null);
	}

	/** 等元数据缓存建好：收到 `resolved` 就继续，收不到最多等 3 秒。 */
	private awaitMetadata(): Promise<void> {
		const cache = this.app.metadataCache;
		if (typeof cache?.on !== "function") return Promise.resolve();
		return new Promise((resolve) => {
			let timer = 0;
			let ref: ReturnType<typeof cache.on> | null = null;
			let settled = false;
			const finish = (): void => {
				if (settled) return;
				settled = true;
				if (ref !== null) cache.offref(ref);
				window.clearTimeout(timer);
				resolve();
			};
			ref = cache.on("resolved", finish);
			timer = window.setTimeout(finish, 3000);
		});
	}

	private async renderList(): Promise<void> {
		const body = this.bodyEl;
		if (body === null) return;

		this.heading(t("practice.list.heading"), t("practice.list.hint"));

		if (this.entries === null) {
			const loading = body.createDiv({ cls: "easy-quiz-practice__loading", text: t("practice.list.scanning") });
			const entries = await this.scan();
			loading.detach();
			// 扫描是异步的：期间用户可能已经切页，避免覆盖新页面。
			if (this.page !== 0 || this.bodyEl !== body) return;
			this.paintList(body, entries);
			return;
		}

		// 已有扫描结果：先按旧数据把列表画出来，再在后台核对一次。
		// 这样切回列表页、文件改动后的刷新都不会先闪一段"正在扫描"的空白。
		this.paintList(body, this.entries);
		if (
			this.stale ||
			this.dirtyPaths.size > 0 ||
			this.currentSignature() !== this.scanSignature
		) {
			void this.refreshList();
		}
	}

	/** 把列表页的完整结构画进 body（调用方负责先放好页头）。 */
	private paintList(body: HTMLElement, entries: FileEntry[]): void {
		// 文件被删除后，选中项要跟着清掉，否则设置页会算不出候选。
		const alive = new Set(entries.map((entry) => entry.file.path));
		this.picked = this.picked.filter((path) => alive.has(path));

		if (entries.length === 0) {
			this.listPainted = true;
			this.renderEmpty(body);
			return;
		}

		this.renderListToolbar(body, entries);
		this.totalsEl = body.createDiv({
			cls: "easy-quiz-practice__totals",
			text: this.totalsText(summarizeAll(entries.map((entry) => entry.summary))),
		});
		// "匹配到几份"只在搜索时出现：没有搜索词时它和上面的合计说的是同一件事。
		this.matchedEl = body.createDiv({ cls: "easy-quiz-practice__matched" });
		this.updateMatchedNote();

		const list = body.createDiv({ cls: "easy-quiz-practice__files" });
		this.fillList(list);

		this.renderListFooter(body);
		this.listPainted = true;
	}

	/**
	 * 后台核对列表数据；只在列表页生效，新的请求合并成一次。
	 *
	 * 刷新时不拆工具条、搜索框与滚动位置：扫描结果回来后只重画清单里的行，
	 * 汇总行、匹配数与底部操作条就地更新。
	 */
	private refreshList(): Promise<void> {
		const running = this.listRefreshTask;
		if (running !== null) {
			this.listRefreshQueued = true;
			return running;
		}
		const task = (async () => {
			do {
				this.listRefreshQueued = false;
				const body = this.bodyEl;
				if (this.closed || this.page !== 0 || body === null) return;
				if (!this.listPainted) {
					// 首屏还没画好：这一轮完整重画会顺带完成扫描；等它结束再补刷新。
					// 真实视图在 `setState` 交回缓存页之前不自己起渲染，否则会先画出
					// 第一页、随后才应用状态，正是按钮"跳错页"的老问题。
					if (this.renderTask !== null || (this.opened && !this.initialRenderDone)) {
						this.listRefreshDeferred = true;
					} else {
						await this.render();
					}
					return;
				}
				const before = this.entries;
				const wasStale = this.stale;
				const entries = await this.scan();
				if (this.closed || this.page !== 0 || this.bodyEl !== body) return;
				// 扫描直接复用了缓存：没有任何变化，不要白白重画清单。
				if (this.entries === before && !wasStale) return;
				this.applyEntries(entries);
			} while (this.listRefreshQueued);
		})();
		/*
		 * 清理必须挂在赋值之后，不能写在 IIFE 自己的 finally 里：`!listPainted`
		 * 那条分支不含 await，IIFE 会同步跑完，finally 先把字段清空、随后这行赋值
		 * 又把已完成的 Promise 写回去——之后所有刷新请求都会被并进这个死任务。
		 */
		this.listRefreshTask = task;
		const clear = (): void => {
			if (this.listRefreshTask !== task) return;
			this.listRefreshTask = null;
			// 任务收尾的同一拍里如果又来了请求，循环已经来不及处理：再补跑一次。
			if (this.listRefreshQueued) {
				this.listRefreshQueued = false;
				void this.refreshList();
			}
		};
		void task.then(clear, clear);
		return task;
	}

	/** 扫描结果回来后就地更新列表；结构与滚动位置保持不变。 */
	private applyEntries(entries: FileEntry[]): void {
		const body = this.bodyEl;
		if (body === null) return;

		const alive = new Set(entries.map((entry) => entry.file.path));
		this.picked = this.picked.filter((path) => alive.has(path));

		if (entries.length === 0) {
			// 从"有题库"变成"一份都没有"：换成空状态说明，工具条随之撤掉。
			body.empty();
			this.clearPageRefs();
			this.heading(t("practice.list.heading"), t("practice.list.hint"));
			this.renderEmpty(body);
			this.listPainted = true;
			return;
		}

		// 之前是空状态（entries 为空）时没有工具条与清单：需要整页重画一次。
		const list = body.querySelector<HTMLElement>(".easy-quiz-practice__files");
		if (list === null || this.totalsEl === null) {
			void this.render();
			return;
		}

		this.totalsEl.setText(this.totalsText(summarizeAll(entries.map((entry) => entry.summary))));
		this.redrawList();
	}

	/** 刷新"匹配到几份"那行：搜索时才显示，没有搜索词就藏起来。 */
	private updateMatchedNote(): void {
		if (this.matchedEl === null) return;
		const searching = this.query.trim() !== "";
		this.matchedEl.toggleClass("is-hidden", !searching);
		if (searching) this.matchedEl.setText(t("practice.list.matched", { count: this.visible().matched.length }));
	}

	private totalsText(totals: SummaryTotals): string {
		const rate = totals.attempts === 0 ? "—" : `${Math.round((totals.correct / totals.attempts) * 100)}%`;
		return [
			t("practice.totals.files", { count: totals.files }),
			t("practice.totals.questions", { count: totals.questions }),
			t("practice.totals.answerable", { count: totals.answerable }),
			t("practice.totals.broken", { count: totals.broken }),
			t("practice.totals.attempts", { count: totals.attempts }),
			t("practice.totals.accuracy", { rate }),
		].join(" · ");
	}

	/**
	 * 工具条：搜索框 + 全选 / 清空 / 折叠 / 重新扫描。
	 *
	 * 「全选可作答」作用于**当前搜索结果**，不是整份 vault：搜索本身就是
	 * 一次筛选，先搜再全选是最顺手的用法。没有搜索词时它就是"选中全部"。
	 */
	private renderListToolbar(body: HTMLElement, entries: FileEntry[]): void {
		const toolbar = body.createDiv({ cls: "easy-quiz-practice__toolbar" });

		const search = toolbar.createEl("input", { cls: "easy-quiz-practice__search" });
		search.type = "search";
		search.value = this.query;
		search.placeholder = t("practice.search.placeholder");
		search.setAttribute("aria-label", t("practice.search.placeholder"));
		search.dataset["action"] = "search";
		search.addEventListener("input", () => {
			this.setQuery(search.value);
		});

		const clearSearch = this.button(toolbar, "clear-search", t("practice.search.clear"));
		clearSearch.disabled = this.query === "";
		clearSearch.addEventListener("click", () => {
			// 只清列表，不重建工具条：搜索框、滚动位置和它上面的焦点都留在原地。
			search.value = "";
			this.setQuery("");
			search.focus();
		});

		const { matched } = this.visible();

		const all = this.button(toolbar, "select-all", t("practice.toolbar.selectAll"));
		all.disabled = !matched.some((entry) => entry.summary.answerable > 0);
		all.addEventListener("click", () => {
			// 候选项在点击时才取：搜索词可能已经变过，渲染时算好的那份会过期。
			const usable = this.visible().matched.filter((entry) => entry.summary.answerable > 0);
			this.picked = [...new Set([...this.picked, ...usable.map((entry) => entry.file.path)])];
			this.syncSelectionUi();
		});

		const clear = this.button(toolbar, "clear-selection", t("practice.toolbar.clear"));
		clear.disabled = this.picked.length === 0;
		clear.addEventListener("click", () => {
			this.picked = [];
			this.syncSelectionUi();
		});

		const foldAll = this.button(toolbar, "fold-all", t("practice.list.foldAll"));
		foldAll.disabled = entries.length === 0;
		foldAll.addEventListener("click", () => {
			this.folded = new Set((this.entries ?? []).map((entry) => entry.summary.folder));
			// 只重画清单：工具条、搜索框与页脚保持原节点，不闪一下再回来。
			this.redrawList();
		});

		const unfoldAll = this.button(toolbar, "unfold-all", t("practice.list.unfoldAll"));
		unfoldAll.disabled = this.folded.size === 0;
		unfoldAll.addEventListener("click", () => {
			this.folded = new Set();
			this.redrawList();
		});

		const rescan = this.button(toolbar, "rescan", t("practice.toolbar.rescan"));
		rescan.addEventListener("click", () => {
			// 手动重扫是明确的"整份数据都别信了"，因此丢掉列表缓存并整页重画。
			this.markStale();
			void this.render();
		});
	}

	/**
	 * 换搜索词并就地重画列表。
	 *
	 * 只更新"会随搜索结果变化的部分"，不整页重画：整页重画会把输入框换成新节点，
	 * 中文输入法正在拼字的那个框就断了。
	 */
	private setQuery(value: string): void {
		this.query = value;
		this.redrawList();
	}

	/** 就地重画文件夹分组、匹配数与底部操作条（搜索、折叠都走这里）。 */
	private redrawList(): void {
		const list = this.bodyEl?.querySelector<HTMLElement>(".easy-quiz-practice__files") ?? null;
		if (list === null) return;
		this.fillList(list);
		this.updateMatchedNote();

		// 搜索结果改变了「全选可作答」的范围，按钮可用状态要跟着换。
		const matched = this.visible().matched;
		const all = this.bodyEl?.querySelector("button[data-action='select-all']") ?? null;
		if (this.isButton(all)) all.disabled = !matched.some((entry) => entry.summary.answerable > 0);
		const clearSearch = this.bodyEl?.querySelector("button[data-action='clear-search']") ?? null;
		if (this.isButton(clearSearch)) clearSearch.disabled = this.query === "";
		// 折叠状态刚变过：「全部展开」只有真的折了东西才该可点。
		const unfoldAll = this.bodyEl?.querySelector("button[data-action='unfold-all']") ?? null;
		if (this.isButton(unfoldAll)) unfoldAll.disabled = this.folded.size === 0;
		this.syncToolbar();
	}

	/** 按当前搜索词画出文件夹分组；没有命中时给一句说明。 */
	private fillList(list: HTMLElement): void {
		list.empty();
		const { matched, groups } = this.visible();
		if (matched.length === 0) {
			list.createDiv({
				cls: "easy-quiz-practice__nomatch",
				text: t("practice.list.noMatch", { query: this.query.trim() }),
			});
		}
		for (const group of groups) this.renderFolderGroup(list, group);
	}

	/**
	 * 一个文件夹：可点击的标题（折叠 / 展开）+ 该组内的文件行。
	 *
	 * 标题右侧自带勾选框，用来整组勾选——文件多的时候"按文件夹挑"比逐个点快得多。
	 */
	private renderFolderGroup(list: HTMLElement, group: FolderGroup): void {
		const isFolded = this.folded.has(group.folder);
		const wrapper = list.createDiv({ cls: "easy-quiz-practice__group" });
		if (isFolded) wrapper.addClass("is-folded");
		// 记下这个分组属于哪个文件夹：之后同步整组勾选框时按键查找，而不是靠 DOM 顺序。
		wrapper.dataset["folder"] = group.folder;

		const head = wrapper.createDiv({ cls: "easy-quiz-practice__folder" });
		head.dataset["action"] = "toggle-folder";
		head.dataset["folder"] = group.folder;
		head.setAttribute("role", "button");
		head.setAttribute("tabindex", "0");
		head.setAttribute(
			"aria-label",
			t(isFolded ? "practice.folder.expand" : "practice.folder.collapse", {
				folder: this.folderLabel(group.folder),
			})
		);

		// 箭头字符由 CSS 用三角形画，避免依赖图标字体。
		head.createSpan({ cls: "easy-quiz-practice__folder-caret" });
		head.createSpan({ cls: "easy-quiz-practice__folder-name", text: this.folderLabel(group.folder) });
		const usable = group.entries.filter((entry) => entry.summary.answerable > 0);
		const selected = usable.filter((entry) => this.picked.includes(entry.file.path)).length;
		head.createSpan({
			cls: "easy-quiz-practice__folder-count",
			text:
				this.query.trim() === ""
					? t("practice.folder.files", { count: group.entries.length })
					: t("practice.folder.filesFiltered", {
							count: group.entries.length,
							total: (this.entries ?? []).filter((entry) => entry.summary.folder === group.folder).length,
						}),
		});

		const check = head.createEl("input", { cls: "easy-quiz-practice__folder-check" });
		check.type = "checkbox";
		check.dataset["action"] = "pick-folder";
		check.dataset["folder"] = group.folder;
		check.disabled = usable.length === 0;
		check.checked = usable.length > 0 && selected === usable.length;
		// 只勾了一部分时给出"部分选中"的第三种状态。
		check.indeterminate = selected > 0 && selected < usable.length;
		check.setAttribute("aria-label", t("practice.folder.check", { folder: this.folderLabel(group.folder) }));
		check.addEventListener("click", (event) => event.stopPropagation());
		check.addEventListener("change", () => {
			const paths = usable.map((entry) => entry.file.path);
			this.picked = check.checked
				? [...new Set([...this.picked, ...paths])]
				: this.picked.filter((path) => !paths.includes(path));
			this.syncSelectionUi();
		});

		const toggle = (): void => {
			if (this.folded.has(group.folder)) this.folded.delete(group.folder);
			else this.folded.add(group.folder);
			this.redrawList();
		};
		head.addEventListener("click", toggle);
		head.addEventListener("keydown", (event) => {
			if (event.key !== "Enter" && event.key !== " ") return;
			event.preventDefault();
			toggle();
		});

		if (isFolded) return;
		const rows = wrapper.createDiv({ cls: "easy-quiz-practice__group-files" });
		for (const entry of group.entries) this.renderFileRow(rows, entry);
	}

	/**
	 * 列表页底部的固定操作条：选中状态的说明 + 进入设置。
	 *
	 * 单独放在末尾（而不是工具条里）是为了让它在手机上也停在同一条位置：
	 * 长列表滚动时勾选完就能立刻出发，不必先滚回顶部。
	 */
	private renderListFooter(body: HTMLElement): void {
		const footer = body.createDiv({ cls: "easy-quiz-practice__footer" });
		this.footerTextEl = footer.createDiv({
			cls: "easy-quiz-practice__footer-text",
			text: this.pickerLabel(),
		});

		const start = this.button(footer, "to-picker", t("practice.list.goSetup"), true);
		start.disabled = this.picked.length === 0;
		start.addEventListener("click", () => this.gotoPicker());

		// 行内勾选后只更新这条操作条，避免整页重画导致勾选闪动。
		this.startEl = start;
		this.countEl = null;
	}

	private pickerLabel(): string {
		return t("practice.toolbar.startSetup", { count: this.picked.length });
	}

	private renderEmpty(body: HTMLElement): void {
		const empty = body.createDiv({ cls: "easy-quiz-practice__empty" });
		empty.createDiv({ text: t("practice.empty.none") });
		const hints = empty.createEl("ul", { cls: "easy-quiz-practice__empty-hints" });
		hints.createEl("li", { text: t("practice.empty.hintFrontmatter") });
		hints.createEl("li", { text: t("practice.empty.hintTag") });
		hints.createEl("li", { text: t("practice.empty.hintGlob") });

		const open = this.button(empty, "open-settings", t("practice.openSettings"));
		open.addEventListener("click", () => this.openSettings());
		const rescan = this.button(empty, "rescan", t("practice.toolbar.rescan"));
		rescan.addEventListener("click", () => {
			this.markStale();
			void this.render();
		});
	}

	/** 文件列表里的一行：勾选框 + 路径 + 题目数据 + 进入设置。 */
	private renderFileRow(list: HTMLElement, entry: FileEntry): void {
		const summary = entry.summary;
		const row = list.createDiv({ cls: "easy-quiz-practice__file" });
		if (this.picked.includes(summary.path)) row.addClass("is-picked");
		if (summary.answerable === 0) row.addClass("is-empty");

		const check = row.createEl("input", { cls: "easy-quiz-practice__check" });
		check.type = "checkbox";
		check.checked = this.picked.includes(summary.path);
		check.disabled = summary.answerable === 0;
		check.dataset["action"] = "pick-file";
		check.dataset["path"] = summary.path;
		check.addEventListener("change", () => {
			this.picked = check.checked
				? [...new Set([...this.picked, summary.path])]
				: this.picked.filter((path) => path !== summary.path);
			this.syncSelectionUi();
		});

		const main = row.createDiv({ cls: "easy-quiz-practice__file-main" });
		const name = main.createDiv({ cls: "easy-quiz-practice__file-name" });
		name.createSpan({ cls: "easy-quiz-practice__file-base", text: entry.file.basename });
		name.createSpan({ cls: "easy-quiz-practice__file-path", text: `/${summary.path}` });

		main.createDiv({ cls: "easy-quiz-practice__file-stats", text: this.fileStatsText(entry) });

		const types = main.createDiv({ cls: "easy-quiz-practice__type-tags" });
		for (const type of TYPE_ORDER) {
			const count = summary.byType[type];
			if (count === 0) continue;
			types.createSpan({ cls: "easy-quiz-practice__type-tag", text: `${typeLabel(type)} ${count}` });
		}

		if (entry.error !== null) {
			main.createDiv({ cls: "easy-quiz-practice__file-error", text: t("practice.file.parseFailed", { error: entry.error }) });
		} else if (summary.issues > 0) {
			main.createDiv({
				cls: "easy-quiz-practice__file-error",
				text: t("practice.file.issues", { count: summary.issues }),
			});
		}

		// 清除记录放在「设置刷题」左边：它是危险操作，离主操作远一点，还带两步确认。
		if (summary.attempts > 0) {
			const label = t("practice.file.clearRecords");
			const clear = this.button(row, "clear-file-records", label);
			clear.addClass("is-danger");
			clear.dataset["path"] = summary.path;
			this.confirmAction(clear, label, async () => {
				const cleared = await this.host.service.clearFileRecords(entry.file);
				if (cleared === 0) {
					new Notice(t("practice.clear.failed"));
					return;
				}
				new Notice(t("practice.clear.doneFile", { count: cleared }));
				// 统计写在笔记里，清完必须重新扫描才能反映出来。
				this.entries = null;
				this.stale = true;
				void this.render();
			});
		}

		const pick = this.button(row, "pick-file-only", t("practice.file.pick"));
		pick.dataset["path"] = summary.path;
		pick.disabled = summary.answerable === 0;
		pick.addEventListener("click", () => {
			this.picked = [summary.path];
			this.gotoPicker();
		});
	}

	private fileStatsText(entry: FileEntry): string {
		const summary = entry.summary;
		const parts = [
			t("practice.file.stats.total", { count: summary.total }),
			t("practice.file.stats.answerable", { count: summary.answerable }),
		];
		if (summary.broken > 0) parts.push(t("practice.file.stats.broken", { count: summary.broken }));
		if (summary.attempts > 0) {
			parts.push(
				t("practice.totals.attempts", { count: summary.attempts }),
				t("practice.totals.accuracy", { rate: `${Math.round((summary.correct / summary.attempts) * 100)}%` })
			);
		} else {
			parts.push(t("practice.file.stats.noRecords"));
		}
		if (summary.lastAt !== null) parts.push(t("practice.file.stats.lastAt", { date: summary.lastAt.slice(0, 10) }));
		return parts.join(" · ");
	}

	private isButton(el: Element | null): el is HTMLButtonElement {
		// jsdom / 测试环境不一定会挂全局 HTMLButtonElement，因此按能力判断而不是 instanceof。
		return el !== null && typeof (el as { disabled?: unknown }).disabled === "boolean";
	}

	/**
	 * 勾选状态变化后只同步 DOM，不重建列表。
	 *
	 * 全选 / 清空 / 整组勾选都走这里：搜索框、工具条、滚动位置和清单里的其他行
	 * 都保持原节点，因此不会出现"点一下按钮整页闪一下、滚回顶部"。
	 */
	private syncSelectionUi(): void {
		const picked = new Set(this.picked);
		const rows = this.bodyEl?.querySelectorAll<HTMLElement>(".easy-quiz-practice__file") ?? null;
		for (const row of Array.from(rows ?? [])) {
			const check = row.querySelector<HTMLInputElement>("input[data-action='pick-file']");
			const path = check?.dataset["path"];
			if (check === null || path === undefined) continue;
			const selected = picked.has(path);
			if (check.checked !== selected) check.checked = selected;
			row.toggleClass("is-picked", selected);
		}
		this.syncToolbar();
	}

	/** 勾选变化后就地更新底部操作条与各文件夹的整组勾选框。 */
	private syncToolbar(): void {
		if (this.startEl !== null) this.startEl.disabled = this.picked.length === 0;
		if (this.footerTextEl !== null) this.footerTextEl.setText(this.pickerLabel());
		const clear = this.bodyEl?.querySelector("button[data-action='clear-selection']") ?? null;
		if (this.isButton(clear)) clear.disabled = this.picked.length === 0;
		this.syncFolderChecks();
	}

	/*
	 * 让每个文件夹标题上的勾选框反映组内状态。
	 *
	 * 单个文件被勾上/取消时要一起更新：整组全选、全不选、部分选中（半勾）是三种不同的样子，
	 * 漏掉这一步就会出现"组里明明全勾了，标题上还是半勾"的错觉。
	 *
	 * 按分组自己记下的文件夹名查找，而不是靠"第几个分组对应第几个 DOM 节点"：
	 * 分组顺序一旦因为排序/过滤变化，按序号对应就会把勾选框更新到别的文件夹上。
	 */
	private syncFolderChecks(): void {
		const wrappers = this.bodyEl?.querySelectorAll<HTMLElement>(".easy-quiz-practice__group") ?? null;
		if (wrappers === null) return;
		const byFolder = new Map(this.visible().groups.map((group) => [group.folder, group]));
		for (const wrapper of Array.from(wrappers)) {
			const folder = wrapper.dataset["folder"];
			const group = folder === undefined ? undefined : byFolder.get(folder);
			if (group === undefined) continue;
			const check = wrapper.querySelector<HTMLInputElement>("input[data-action='pick-folder']");
			if (check === null) continue;
			const usable = group.entries.filter((entry) => entry.summary.answerable > 0);
			const selected = usable.filter((entry) => this.picked.includes(entry.file.path)).length;
			check.checked = usable.length > 0 && selected === usable.length;
			check.indeterminate = selected > 0 && selected < usable.length;
		}
	}

	private gotoPicker(): void {
		this.page = 1;
		void this.render();
	}

	/**
	 * 给按钮加上两步确认：第一次点击只是"上膛"，再点一次才真正执行。
	 *
	 * 清除记录不可撤销，但又不想弹窗打断列表操作，所以用按钮自身给出确认提示；
	 * 4 秒内没有再点就自动恢复原文案。
	 */
	private confirmAction(button: HTMLButtonElement, label: string, action: () => void | Promise<void>): void {
		let armed = false;
		let timer: number | null = null;
		const reset = (): void => {
			armed = false;
			button.setText(label);
			button.removeClass("is-warning");
			if (timer !== null) window.clearTimeout(timer);
			timer = null;
		};
		button.addEventListener("click", () => {
			if (!armed) {
				armed = true;
				button.setText(t("practice.clear.confirm"));
				button.addClass("is-warning");
				timer = window.setTimeout(reset, 4000);
				return;
			}
			reset();
			void action();
		});
	}

	// -----------------------------------------------------------------------
	// 页面 2：刷题设置
	// -----------------------------------------------------------------------

	/** 从队列里取出的候选题（已按题型 / 只刷错题过滤）。 */
	private candidates(): QuizQuestion[] {
		const all: QuizQuestion[] = [];
		for (const path of this.picked) {
			const parsed = this.parsedByPath.get(path);
			if (parsed === undefined) continue;
			all.push(...parsed.questions);
		}
		return filterQuestions(all, this.config);
	}

	/** 选中文件里的全部可作答题数（不受筛选影响，作为基数展示）。 */
	private availableCount(): number {
		let total = 0;
		for (const path of this.picked) {
			const parsed = this.parsedByPath.get(path);
			if (parsed === undefined) continue;
			total += parsed.questions.filter((question) => question.ok).length;
		}
		return total;
	}

	/** 这一轮实际会抽出的题数（与 `buildSession` 的取数规则一致）。 */
	private plannedCount(candidates: number): number {
		if (this.config.mode !== "random") return candidates;
		if (this.config.randomCount <= 0) return candidates;
		return Math.min(this.config.randomCount, candidates);
	}

	private typeCounts(): Record<QuizType, number> {
		const counts: Record<QuizType, number> = { single: 0, multi: 0, match: 0, blank: 0, essay: 0 };
		for (const path of this.picked) {
			const parsed = this.parsedByPath.get(path);
			if (parsed === undefined) continue;
			for (const question of parsed.questions) {
				if (!question.ok || question.type === null) continue;
				counts[question.type] += 1;
			}
		}
		return counts;
	}

	/**
	 * 按路径解析出文件，并填好渲染题面所需的 TFile 映射。
	 *
	 * `force` 为 true 时重新解析（设置页按钮、或题库文件刚被改动）。
	 * 本窗口自己写回的记录也会把 `stale` 打开，因此这里统一收敛这一处状态：
	 * 解析一次就把 `stale` 清掉，避免每画一张卡片都重解析一遍。
	 *
	 * 缓存与当前选中集合严格对齐：不在 `picked` 里的解析结果一律丢弃，
	 * 保证下游（`candidates` / `buildSession`）看到的只有这一轮真正选中的题库。
	 */
	private async loadParsed(force = false): Promise<void> {
		const reparse = force || this.stale;

		// 选中集合可能已经换过文件（返回列表改勾选）。缓存里没有被选中的解析结果
		// 必须丢掉：`buildSession` 遍历的是整张表，留着它就会把取消勾选的题库
		// 一起抽进这一轮，表现为两个题库的题叠在一起。
		const picked = new Set(this.picked);
		for (const path of [...this.parsedByPath.keys()]) {
			if (!picked.has(path)) this.parsedByPath.delete(path);
		}
		for (const path of [...this.fileAt.keys()]) {
			if (!picked.has(path)) this.fileAt.delete(path);
		}

		for (const path of this.picked) {
			const file = this.host.service.fileAtPath(path);
			if (file === null) {
				this.parsedByPath.delete(path);
				continue;
			}
			this.fileAt.set(path, file);
			if (this.parsedByPath.has(path) && !reparse) continue;
			try {
				this.parsedByPath.set(path, await this.host.service.parseFile(file));
			} catch {
				// 解析失败的文件按"没有题目"处理：设置页会显示 0 题，而不是抛错。
				this.parsedByPath.delete(path);
			}
		}
		this.stale = false;
	}

	private async renderPicker(): Promise<void> {
		const body = this.bodyEl;
		if (body === null) return;

		if (this.picked.length === 0) {
			this.heading(t("practice.picker.heading"), t("practice.picker.noFiles"));
			const back = this.button(body, "goto-list", t("practice.picker.back"), true);
			back.addEventListener("click", () => {
				this.page = 0;
				void this.render();
			});
			return;
		}

		// 页头先画：解析选中题库可能要走一次磁盘，期间窗口不至于只剩一块空白。
		this.heading(t("practice.picker.heading"), t("practice.picker.hint"));

		await this.loadParsed();
		if (this.page !== 1 || this.bodyEl !== body) return;

		const files = body.createDiv({ cls: "easy-quiz-practice__picked" });
		for (const path of this.picked) {
			const chip = files.createDiv({ cls: "easy-quiz-practice__chip" });
			const parsed = this.parsedByPath.get(path);
			const count = parsed === undefined ? 0 : parsed.questions.filter((question) => question.ok).length;
			chip.createSpan({ text: t("practice.picker.chip", { path, count }) });
			const remove = chip.createEl("button", { text: "✕" });
			remove.setAttribute("aria-label", t("practice.picker.remove", { path }));
			remove.dataset["action"] = "unpick-file";
			remove.dataset["path"] = path;
			remove.addEventListener("click", () => {
				this.picked = this.picked.filter((item) => item !== path);
				this.parsedByPath.delete(path);
				void this.render();
			});
		}

		// 设置行合成一张卡片：视觉上是一组"这一轮怎么抽题"的决定。
		const panel = body.createDiv({ cls: "easy-quiz-practice__panel" });
		this.renderModeSetting(panel);
		this.renderTypeSetting(panel);
		this.renderErrorRateSetting(panel);
		this.renderShuffleSetting(panel);
		this.renderStartRow(body);
		this.refreshCounts();
	}

	/** 抽题方式：三个互斥按钮 + 随机模式的数量输入。 */
	private renderModeSetting(body: HTMLElement): void {
		const setting = new Setting(body).setName(t("practice.picker.modeName")).setDesc(t(MODE_HINT_KEYS[this.config.mode]));
		setting.settingEl.addClass("easy-quiz-practice__setting");

		const group = setting.controlEl.createDiv({ cls: "easy-quiz-practice__modes" });
		for (const mode of MODES) {
			const button = group.createEl("button", { text: t(MODE_LABEL_KEYS[mode]) });
			button.dataset["action"] = "set-mode";
			button.dataset["mode"] = mode;
			button.toggleClass("is-active", this.config.mode === mode);
			button.addEventListener("click", () => {
				this.config.mode = mode;
				// 「只刷错题」与「只留上次答错」是同一件事的两个入口，保持一致。
				this.config.wrongOnly = mode === "wrong";
				void this.render();
			});
		}

		// 数量只在「定量随机抽查」下才有意义：其它模式里留一个灰掉的输入框，既占
		// 一行地方，又像一张没填完的表；连标签一起收起来，切换模式时再重画。
		if (this.config.mode !== "random") return;

		const row = setting.controlEl.createDiv({ cls: "easy-quiz-practice__random" });
		row.createSpan({ cls: "easy-quiz-practice__random-label", text: t("practice.picker.randomCount") });

		setting.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = "0";
			text.inputEl.dataset["action"] = "random-count";
			text.setValue(String(this.config.randomCount));
			row.appendChild(text.inputEl);
			text.onChange((value) => {
				const parsed = Number.parseInt(value, 10);
				this.config.randomCount = Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
				this.refreshCounts();
			});
		});
	}

	/** 题型多选：按当前文件里实际存在的题量标注。 */
	private renderTypeSetting(body: HTMLElement): void {
		const counts = this.typeCounts();
		const setting = new Setting(body)
			.setName(t("practice.picker.typeName"))
			.setDesc(t("practice.picker.typeDesc"));
		setting.settingEl.addClass("easy-quiz-practice__setting");

		const group = setting.controlEl.createDiv({ cls: "easy-quiz-practice__types" });
		for (const type of TYPE_ORDER) {
			const label = group.createEl("label", { cls: "easy-quiz-practice__type" });
			const box = label.createEl("input");
			box.type = "checkbox";
			box.dataset["action"] = "pick-type";
			box.dataset["type"] = type;
			box.checked = this.config.types.includes(type);
			box.disabled = counts[type] === 0;
			box.addEventListener("change", () => {
				this.config.types = box.checked
					? [...new Set([...this.config.types, type])]
					: this.config.types.filter((item) => item !== type);
				this.refreshCounts();
			});
			label.createSpan({ text: t("practice.picker.typeLabel", { label: typeLabel(type), count: counts[type] }) });
		}
	}

	/**
	 * 按错误率筛选：只留错误率不低于所选阈值的题。
	 *
	 * 阈值放在下拉框里而不是输入框里：常见用法是"错误率过半"或"每次都错"，
	 * 固定档位既不需要校验，也不会出现「0 到底是不限还是只看答过的题」的歧义——
	 * 0 这档直接写作「不限」。所有选项共用同一句说明，窄屏下也只是一行。
	 */
	private renderErrorRateSetting(body: HTMLElement): void {
		const setting = new Setting(body)
			.setName(t("practice.picker.errorRateName"))
			.setDesc(t("practice.picker.errorRateDesc"));
		setting.settingEl.addClass("easy-quiz-practice__setting");

		// 用原生 select 而不是 Setting.addDropdown：这里只需要一组固定档位，
		// 直接建元素既省一层包装，也让「当前值 → 选项」的对应关系一目了然。
		const select = setting.controlEl.createEl("select", { cls: "dropdown" });
		select.dataset["action"] = "error-rate";
		select.setAttribute("aria-label", t("practice.picker.errorRateName"));
		for (const rate of ERROR_RATE_STEPS) {
			const option = select.createEl("option", {
				text: rate === 0 ? t("practice.picker.errorRateAny") : t("practice.picker.errorRateOption", { rate }),
			});
			option.value = String(rate);
		}
		select.value = String(normalizeErrorRate(this.config.minErrorRate));
		select.addEventListener("change", () => {
			const parsed = Number.parseInt(select.value, 10);
			this.config.minErrorRate = Number.isNaN(parsed) ? 0 : normalizeErrorRate(parsed);
			this.refreshCounts();
		});
	}

	private renderShuffleSetting(body: HTMLElement): void {
		const setting = new Setting(body)
			.setName(t("practice.picker.shuffleName"))
			.setDesc(t("practice.picker.shuffleDesc"));
		setting.settingEl.addClass("easy-quiz-practice__setting");
		setting.addToggle((toggle) =>
			toggle.setValue(this.config.shuffleOptions).onChange((value) => {
				this.config.shuffleOptions = value;
			})
		);
	}

	private renderStartRow(body: HTMLElement): void {
		const row = body.createDiv({ cls: "easy-quiz-practice__footer" });
		this.countEl = row.createDiv({ cls: "easy-quiz-practice__count" });
		this.countEl.dataset["action"] = "session-count";

		const actions = row.createDiv({ cls: "easy-quiz-practice__footer-actions" });
		const back = this.button(actions, "goto-list", t("practice.picker.back"));
		back.addEventListener("click", () => {
			this.page = 0;
			void this.render();
		});

		this.startEl = this.button(actions, "start-session", t("practice.picker.start"), true);
		this.startEl.addEventListener("click", () => {
			void this.startSession();
		});
	}

	/** 实时刷新"候选多少题 / 这一轮抽多少题"。 */
	private refreshCounts(): void {
		const count = this.countEl;
		const start = this.startEl;
		if (count === null) return;

		const candidates = this.candidates().length;
		const planned = this.plannedCount(candidates);
		count.setText(
			[
				t("practice.count.available", { count: this.availableCount() }),
				t("practice.count.matching", { count: candidates }),
				t("practice.count.planned", { count: planned }),
			].join(" · ")
		);
		if (start !== null) start.disabled = candidates === 0;
	}

	// -----------------------------------------------------------------------
	// 页面 3：刷题
	// -----------------------------------------------------------------------

	private async startSession(): Promise<void> {
		await this.loadParsed();
		// 「打乱选项」直接作用在队列上：先抽题，再按需把题序打乱。
		const config: SessionConfig = { ...this.config, shuffle: this.config.shuffleOptions };
		const queue = buildSession(config, this.parsedByPath);
		if (queue.length === 0) {
			new Notice(t("practice.notice.empty"));
			return;
		}

		this.queue = queue;
		this.cursor = 0;
		this.results = this.queue.map(() => null);
		this.answers = this.queue.map(() => null);
		this.reviewing = false;
		this.finished = false;
		this.dirty = false;
		// 每一轮换一颗选项打乱种子：轮内复盘不跳位，重新开始一轮则重新洗牌。
		this.sessionSeed = Math.floor(Math.random() * 0xffff_ffff);
		this.page = 2;
		await this.render();
	}

	private async renderSession(): Promise<void> {
		const body = this.bodyEl;
		if (body === null) return;

		if (this.queue.length === 0) {
			this.heading(t("practice.title"), t("practice.session.finished"));
			const back = this.button(body, "goto-list", t("practice.session.backToList"), true);
			back.addEventListener("click", () => {
				this.page = 0;
				void this.render();
			});
			return;
		}

		// 页头、进度与卡片容器先画出来；重新解析期间只让卡片区显示一句"正在载入"。
		const head = body.createDiv({ cls: "easy-quiz-practice__head" });
		head.createEl("h3", { cls: "easy-quiz-practice__title", text: t("practice.title") });
		const toolbar = head.createDiv({ cls: "easy-quiz-practice__toolbar is-compact" });
		const end = this.button(toolbar, "end-session", t("practice.session.end"));
		end.addEventListener("click", () => {
			this.finish();
			void this.render();
		});

		this.progressEl = body.createDiv({ cls: "easy-quiz-practice__progress" });
		this.cardHost = body.createDiv({ cls: "easy-quiz-practice__card" });
		this.renderProgress();
		this.cardHost.createDiv({ cls: "easy-quiz-practice__loading", text: t("practice.loading") });

		// 本轮写回过记录：重新解析，成绩与题面才是最新的。
		await this.loadParsed();
		if (this.page !== 2 || this.bodyEl !== body) return;

		await this.renderCard();
	}

	/** 进度条与计数；只重画进度区域，不动题卡。 */
	private renderProgress(): void {
		const host = this.progressEl;
		if (host === null) return;
		host.empty();

		// 进度要包含当前这道题刚提交的结果，因此看的是"已处理到第几项"。
		const progress = sessionProgress(this.cursor + 1, this.queue.length, this.results);
		const entry = this.queue[this.cursor];
		const head = host.createDiv({ cls: "easy-quiz-practice__progress-head" });
		head.createSpan({
			cls: "easy-quiz-practice__progress-index",
			text: t("practice.session.index", {
				index: Math.min(this.cursor + 1, this.queue.length),
				total: this.queue.length,
			}),
		});
		head.createSpan({
			cls: "easy-quiz-practice__progress-count",
			text: t("practice.session.progress", {
				correct: progress.correct,
				wrong: progress.wrong,
				answered: progress.answered,
			}),
		});

		const bar = host.createDiv({ cls: "easy-quiz-practice__bar" });
		bar.createDiv({ cls: "easy-quiz-practice__bar-fill" }).style.width = `${progress.percent}%`;
		if (entry !== undefined) {
			host.createDiv({ cls: "easy-quiz-practice__progress-path", text: `/${entry.path}` });
		}
	}

	/** 画当前这道题；本轮结束时改画成绩单。 */
	private async renderCard(): Promise<void> {
		const host = this.cardHost;
		if (host === null) return;

		this.releaseCard();
		host.empty();

		const entry = this.queue[this.cursor];
		if (this.finished || entry === undefined) {
			this.renderSummary(host);
			return;
		}

		const file = this.fileAt.get(entry.path);
		const question = resolveEntry(this.parsedByPath, entry);
		if (file === undefined || question === undefined) {
			host.createDiv({
				cls: "easy-quiz-card is-diagnostic",
				text: t("practice.session.missing"),
			});
			this.renderNav(host);
			return;
		}

		// `renderQuizCard` 把题卡追加到传入的元素里，因此直接挂在窗口的卡片容器上，
		// 复盘内容与导航按钮就是同一个容器的兄弟节点，顺序天然是"题卡在上、按钮在下"。
		const context: CardContext = {
			app: this.app,
			service: this.host.service,
			file,
			el: host,
			blankMarker: this.host.settings.blankMarker,
			showStaleHint: this.host.settings.showStaleHint,
			onDismissStaleHint: () => this.host.dismissStaleHint?.(),
			// 「打乱顺序」开关也作用于选择题的选项顺序（题目自己写的 shuffle: true 同样生效）。
			shuffleOptions: this.config.shuffleOptions,
			shuffleSeed: this.sessionSeed,
			// 复盘态由窗口控制：提交后由 renderQuizCard 自己把答案摊在卡片里。
			reviewOnly: this.reviewing,
			// 已答过的题切回来时，把当时的作答一起交回题卡，复盘区才能显示「你的答案」。
			lastAnswer: this.answers[this.cursor] ?? undefined,
			// 题卡里的 Markdown 子组件（图片、嵌入块）交给本视图托管，窗口关闭或换题时卸载。
			addRenderChild: (child) => {
				this.addChild(child);
				this.cardComponents.push(child);
			},
			onSubmitted: (result, answer) => {
				// 一道题只计一次分：复盘重渲染不会再改分。
				if (this.results[this.cursor] === null) this.results[this.cursor] = result.correct;
				// 作答内容每次都记：复盘重渲染交回的是同一份内容，覆盖没有副作用。
				if (answer !== undefined) this.answers[this.cursor] = answer;
				this.dirty = true;
				this.afterSubmit(host, result);
			},
			// 题卡右上角的编辑按钮：跳回题库里的这道题。
			onOpenSource: () => void this.openSource(),
			onCleanup: (cleanup) => this.cardCleanups.push(cleanup),
		};
		// 默认就是笔记里用的那一份题卡渲染器；测试可以注入替身。
		const renderCard = this.host.cardRenderer ?? renderQuizCard;
		try {
			await renderCard(question, context);
		} catch (error) {
			host.createDiv({
				cls: "easy-quiz-card is-diagnostic",
				text: t("practice.session.cardFailed", {
					error: error instanceof Error ? error.message : String(error),
				}),
			});
			this.renderNav(host);
			return;
		}

		// 刷新题卡后重画进度与导航（它们挂在卡片容器上，不受 host.empty() 影响）。
		this.renderProgress();
		if (this.reviewing) this.afterSubmit(host);
		else this.renderNav(host);
	}

	/** 提交之后的收尾：停掉提交按钮，把导航换成"下一题"。 */
	private afterSubmit(host: HTMLElement, result?: GradeResult): void {
		for (const button of Array.from(host.querySelectorAll(".easy-quiz-card__actions button"))) {
			(button as HTMLButtonElement).disabled = true;
			button.addClass("is-hidden");
		}
		/*
		 * 按钮藏起来之后这一行只剩外边距，会在选项和解析之间留下一段空白。
		 * 整行一起收掉：复盘区的间距由它自己的 margin-top 决定。
		 */
		for (const row of Array.from(host.querySelectorAll(".easy-quiz-card__actions"))) {
			row.addClass("is-hidden");
		}
		/*
		 * 角标是在渲染时按文件里的记录算出来的，刚提交这一次还没有写回去的副本
		 * 可读；就地补上，免得复盘时「回答正确」旁边还挂着「未作答」。
		 * 只认带结果的调用：复盘重画走的是同一个方法，不能再计一次。
		 */
		if (result !== undefined) {
			const entry = this.queue[this.cursor];
			const question = entry === undefined ? undefined : resolveEntry(this.parsedByPath, entry);
			if (question !== undefined) {
				question.stats = {
					attempts: question.stats.attempts + 1,
					correct: question.stats.correct + (result.correct ? 1 : 0),
					lastResult: result.correct ? "correct" : "wrong",
					lastAt: new Date().toISOString(),
				};
				const badge = host.querySelector<HTMLElement>(".easy-quiz-card__stats");
				if (badge !== null) badge.setText(formatStats(question));
			}
		}
		this.reviewing = true;
		this.renderProgress();
		this.renderNav(host);
	}

	/** 上一题 / 下一题 / 查看解析 / 跳题。 */
	private renderNav(host: HTMLElement): void {
		for (const existing of Array.from(host.querySelectorAll(".easy-quiz-practice__nav"))) existing.detach();
		const nav = host.createDiv({ cls: "easy-quiz-practice__nav" });

		const prev = this.button(nav, "prev-question", t("practice.session.prev"));
		prev.disabled = this.cursor === 0;
		prev.addEventListener("click", () => {
			void this.goTo(this.cursor - 1);
		});

		const last = this.cursor >= this.queue.length - 1;
		const next = this.button(
			nav,
			"next-question",
			last ? t("practice.session.results") : t("practice.session.next"),
			true
		);
		next.addEventListener("click", () => {
			if (last) {
				this.finish();
				void this.render();
				return;
			}
			void this.goTo(this.cursor + 1);
		});

		// 作答前也能直接看答案：看过的题按"未作答"处理，不计入正确率。
		if (!this.reviewing) {
			const peek = this.button(nav, "peek", t("practice.session.peek"));
			peek.addEventListener("click", () => {
				this.reviewing = true;
				void this.renderCard();
			});
		}

		// 右侧操作组：清除记录与跳题输入框靠右，和左侧的翻页/解析拉开距离，避免误触。
		const queued = this.queue[this.cursor];
		const current = queued === undefined ? undefined : resolveEntry(this.parsedByPath, queued);
		const hasRecords =
			current !== undefined && (current.stats.attempts > 0 || current.history.length > 0);
		const end =
			hasRecords || this.queue.length > 3
				? nav.createDiv({ cls: "easy-quiz-practice__nav-end" })
				: undefined;
		const right = end ?? nav;

		// 清除当前题的作答记录：有记录时才出现，清完这道题回到「未作答」。
		if (current !== undefined && hasRecords) {
			const label = t("practice.session.clearRecords");
			const clear = this.button(right, "clear-question-records", label);
			clear.addClass("is-danger");
			this.confirmAction(clear, label, async () => {
				const entry = this.queue[this.cursor];
				const file = entry === undefined ? undefined : this.fileAt.get(entry.path);
				if (entry === undefined || file === undefined) return;
				const ok = await this.host.service.clearQuestionRecords(file, entry.id);
				if (!ok) {
					new Notice(t("practice.clear.failed"));
					return;
				}
				current.stats = { attempts: 0, correct: 0, lastResult: null, lastAt: null };
				current.history = [];
				const badge = host.querySelector<HTMLElement>(".easy-quiz-card__stats");
				if (badge !== null) badge.setText(formatStats(current));
				// 列表里的统计也是从文件重新扫描来的，标记过期后返回列表才会更新。
				this.entries = null;
				this.stale = true;
				this.results[this.cursor] = null;
				this.answers[this.cursor] = null;
				new Notice(t("practice.clear.doneQuestion"));
				void this.goTo(this.cursor);
			});
		}

		if (this.queue.length > 3) {
			const jump = right.createEl("input", { cls: "easy-quiz-practice__jump" });
			jump.type = "number";
			jump.min = "1";
			jump.max = String(this.queue.length);
			jump.value = String(this.cursor + 1);
			jump.dataset["action"] = "jump";
			jump.setAttribute("aria-label", t("practice.session.jump"));
			jump.addEventListener("change", () => {
				const target = Number.parseInt(jump.value, 10);
				if (Number.isNaN(target)) return;
				void this.goTo(Math.min(Math.max(target - 1, 0), this.queue.length - 1));
			});
		}
	}

	/**
	 * 打开当前题目所在的笔记，并跳到题目标题。
	 *
	 * 拼链接、打开、定位都由 `source-note.ts` 负责：它先按 Obsidian 的写法拼标题
	 * 链接，打开之后再按题面所在的行号定位一次，标题末尾的知识点链接不会让定位落空。
	 */
	private async openSource(): Promise<void> {
		const entry = this.queue[this.cursor];
		if (entry === undefined) return;
		const file = this.fileAt.get(entry.path) ?? this.host.service.fileAtPath(entry.path);
		if (file === null || file === undefined) return;
		await openQuestionSource(this.app, file, resolveEntry(this.parsedByPath, entry));
	}

	/** 切到队列里的某一题。 */
	private async goTo(index: number): Promise<void> {
		if (index < 0 || index >= this.queue.length) return;
		this.cursor = index;
		// 已经答过的题重看时直接进复盘态，避免"再答一次"造成重复写回。
		this.reviewing = this.results[index] !== null;
		this.renderProgress();
		await this.renderCard();
	}

	private finish(): void {
		this.finished = true;
		// 本轮写回过记录：列表页的统计已经过期。
		if (this.dirty) this.entries = null;
	}

	private renderSummary(host: HTMLElement): void {
		const progress = sessionProgress(this.queue.length, this.queue.length, this.results);
		const answered = this.results.filter((result) => result !== null).length;
		const rate = answered === 0 ? 0 : Math.round((progress.correct / answered) * 100);

		const panel = host.createDiv({ cls: "easy-quiz-practice__summary" });
		panel.createDiv({ cls: "easy-quiz-practice__summary-title", text: t("practice.summary.title") });
		panel.createDiv({
			cls: "easy-quiz-practice__summary-line",
			text: t("practice.summary.line", {
				total: this.queue.length,
				answered,
				correct: progress.correct,
				wrong: progress.wrong,
				rate,
			}),
		});
		if (this.dirty && !this.host.settings.writeBackEnabled) {
			panel.createDiv({
				cls: "easy-quiz-practice__hint",
				text: t("practice.summary.writeBackOff"),
			});
		}

		const wrongEntries = this.queue.filter((_, index) => this.results[index] === false);
		if (wrongEntries.length > 0) {
			const list = panel.createDiv({ cls: "easy-quiz-practice__wrong" });
			list.createDiv({ cls: "easy-quiz-practice__summary-sub", text: t("practice.summary.wrongTitle") });
			for (const entry of wrongEntries) {
				list.createDiv({
					cls: "easy-quiz-practice__wrong-item",
					text: t("practice.summary.wrongItem", { title: entry.title, path: entry.path }),
				});
			}
		}

		const actions = panel.createDiv({ cls: "easy-quiz-practice__toolbar" });
		const again = this.button(actions, "restart-session", t("practice.summary.again"), true);
		again.addEventListener("click", () => {
			void this.restart();
		});

		const retryWrong = this.button(actions, "retry-wrong", t("practice.summary.retryWrong"));
		retryWrong.disabled = wrongEntries.length === 0;
		retryWrong.addEventListener("click", () => {
			this.queue = wrongEntries;
			this.cursor = 0;
			this.results = this.queue.map(() => null);
			this.answers = this.queue.map(() => null);
			this.reviewing = false;
			this.finished = false;
			// 新一轮：换一颗种子，选项重新洗一遍。
			this.sessionSeed = Math.floor(Math.random() * 0xffff_ffff);
			void this.render();
		});

		const back = this.button(actions, "goto-list", t("practice.session.backToList"));
		back.addEventListener("click", () => {
			this.page = 0;
			void this.render();
		});
	}

	private async restart(): Promise<void> {
		this.cursor = 0;
		this.results = this.queue.map(() => null);
		this.answers = this.queue.map(() => null);
		this.reviewing = false;
		this.finished = false;
		// 新一轮：换一颗种子，选项重新洗一遍。
		this.sessionSeed = Math.floor(Math.random() * 0xffff_ffff);
		await this.render();
	}
}

/** 解析彻底失败时用来汇总的空结果：题量与记录一律为 0。 */
function emptyParse(): ParsedQuizFile {
	return {
		fileIsQuiz: true,
		detectedBy: "none",
		schemaVersion: null,
		frontmatter: {},
		questions: [],
		warnings: [],
	};
}

/** 两个字符串数组是否逐项相同（顺序也相同）。 */
function sameStrings(first: readonly string[], second: readonly string[]): boolean {
	if (first.length !== second.length) return false;
	return first.every((item, index) => item === second[index]);
}

/** 两个字符串集合是否相同。 */
function sameSet(first: ReadonlySet<string>, second: ReadonlySet<string>): boolean {
	if (first.size !== second.size) return false;
	for (const item of first) {
		if (!second.has(item)) return false;
	}
	return true;
}

/**
 * 题库文件集合的指纹：路径 + 修改时间。
 *
 * 增删文件会改变行数与路径；编辑文件会改变 mtime。列表缓存与一次扫描
 * 结果因此能判断"还需不需要重解析"，避免每切一次标签页就整库重扫。
 */
function fileSignature(files: readonly { path: string; stat: { mtime: number } }[]): string {
	return files.map((file) => `${file.path}\u0000${file.stat.mtime}`).join("\n");
}
