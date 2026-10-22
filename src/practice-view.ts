/**
 * 刷题窗口：一个包含三个页面的 ItemView。
 *
 * 1. **题库列表**：按文件路径列出 vault 里所有题库文件，逐份给出题量、
 *    可作答数、需要修正的提示以及正确率——"文件路径 + 数据"在同一行里看完。
 * 2. **刷题设置**：选定文件后挑题型与抽题方式（顺序 / 定量随机 / 只刷错题），
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
import type { GradeResult } from "./grade";
import { CardContext, renderQuizCard } from "./view";

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

/** 窗口只要求宿主提供设置与解析服务，因此不必 import 插件类（避免循环依赖）。 */
export interface EasyQuizHost {
	settings: RuntimeSettings;
	service: QuizService;
	/**
	 * 题卡渲染入口。默认就是 `renderQuizCard`（与笔记里渲染的是同一份实现），
	 * 留出这个口子是为了测试能替换掉题卡内部交互，只验证窗口本身的行为。
	 */
	cardRenderer?: (question: QuizQuestion, ctx: CardContext) => Promise<void>;
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

	/** 刷题会话。 */
	private queue: QueueEntry[] = [];
	private cursor = 0;
	/** 逐题结果；null 表示还没作答。长度与 `queue` 对齐。 */
	private results: (boolean | null)[] = [];
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
			// 搜索词与折叠状态属于"用户怎么看这份清单"，重建工作区时应当保留。
			query: this.query,
			folded: [...this.folded],
		};
	}

	async setState(state: unknown, _result: unknown): Promise<void> {
		if (typeof state !== "object" || state === null) return;
		const data = state as Record<string, unknown>;
		const page = data["page"];
		if (page === 0 || page === 1 || page === 2) this.page = page;
		const picked = data["picked"];
		if (Array.isArray(picked)) {
			this.picked = picked.filter((item): item is string => typeof item === "string");
		}
		const query = data["query"];
		if (typeof query === "string") this.query = query;
		const folded = data["folded"];
		if (Array.isArray(folded)) {
			this.folded = new Set(folded.filter((item): item is string => typeof item === "string"));
		}
		const mode = data["mode"];
		if (mode === "order" || mode === "random" || mode === "wrong") this.config.mode = mode;
		const count = data["randomCount"];
		if (typeof count === "number" && Number.isFinite(count)) {
			this.config.randomCount = Math.max(0, Math.round(count));
		}
		// 队列没有持久化：恢复到刷题页时退回设置页，避免出现空白的第三页。
		if (this.page === 2) this.page = this.picked.length > 0 ? 1 : 0;
	}

	/** 命令/丝带打开窗口时调用：回到题库列表并重新扫描。 */
	async activate(): Promise<void> {
		this.page = 0;
		this.entries = null;
		this.stale = true;
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
		this.entries = null;
		this.stale = true;
		await this.render();
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {
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
	}

	/** 宿主声明题库数据可能已变化：下次渲染前重新解析。 */
	markStale(): void {
		this.stale = true;
		this.entries = null;
	}

	// -----------------------------------------------------------------------
	// 页面骨架
	// -----------------------------------------------------------------------

	/** 释放题卡自己的资源（配对题的观察者会在卡片被换掉后一直看着旧节点）。 */
	private releaseCard(): void {
		for (const cleanup of this.cardCleanups.splice(0)) cleanup();
		for (const child of this.cardComponents.splice(0)) this.removeChild(child);
	}

	/** 重画整个窗口；页面切换、数据刷新都走这一个入口。 */
	async render(): Promise<void> {
		// 每次重画都重新取一遍设置，设置页改动后无需重开窗口。
		this.host.service.updateSettings(this.host.settings);

		const content = this.contentEl;
		this.releaseCard();
		content.empty();

		this.rootEl = content.createDiv({ cls: "easy-quiz-practice" });
		this.navEl = this.rootEl.createDiv({ cls: "easy-quiz-practice__steps" });
		this.bodyEl = this.rootEl.createDiv({ cls: "easy-quiz-practice__body" });
		this.progressEl = null;
		this.cardHost = null;
		this.countEl = null;
		this.startEl = null;
		this.footerTextEl = null;
		this.matchedEl = null;

		this.renderSteps();

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

		const groups: FolderGroup[] = [];
		for (const entry of matched) {
			const folder = entry.summary.folder;
			const last = groups[groups.length - 1];
			// `visible()` 的输入已按路径排序，同一个文件夹的文件必然相邻。
			if (last === undefined || last.folder !== folder) {
				groups.push({ folder, entries: [entry] });
			} else {
				last.entries.push(entry);
			}
		}
		return { matched, groups };
	}

	/** 文件夹在界面上的显示名；vault 根用一句人话代替空字符串。 */
	private folderLabel(folder: string): string {
		return folder === "" ? t("practice.list.rootFolder") : `/${folder}`;
	}

	/** 扫描 vault 里的题库文件并逐份解析；结果缓存在 `entries` 里。 */
	private async scan(): Promise<FileEntry[]> {
		if (this.entries !== null && !this.stale) return this.entries;

		const entries: FileEntry[] = [];
		for (const file of this.host.service.listQuizFiles()) {
			try {
				const parsed = await this.host.service.parseFile(file);
				entries.push({
					file,
					summary: summarizeFile(parsed, file.path, file.stat.mtime),
					parsed,
					error: null,
				});
			} catch (error) {
				// 单份文件解析失败不能拖垮整个列表：给出错误摘要，题量按 0 计。
				entries.push({
					file,
					summary: summarizeFile(emptyParse(), file.path, file.stat.mtime),
					parsed: null,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		entries.sort((first, second) => first.file.path.localeCompare(second.file.path));
		this.entries = entries;
		this.stale = false;
		return entries;
	}

	private async renderList(): Promise<void> {
		const body = this.bodyEl;
		if (body === null) return;

		this.heading(t("practice.list.heading"), t("practice.list.hint"));
		const loading = body.createDiv({ cls: "easy-quiz-practice__loading", text: t("practice.list.scanning") });

		const entries = await this.scan();
		loading.detach();
		// 扫描是异步的：期间用户可能已经切页，避免覆盖新页面。
		if (this.page !== 0 || this.bodyEl !== body) return;

		// 文件被删除后，选中项要跟着清掉，否则设置页会算不出候选。
		const alive = new Set(entries.map((entry) => entry.file.path));
		this.picked = this.picked.filter((path) => alive.has(path));

		if (entries.length === 0) {
			this.renderEmpty(body);
			return;
		}

		this.renderListToolbar(body, entries);
		body.createDiv({
			cls: "easy-quiz-practice__totals",
			text: this.totalsText(summarizeAll(entries.map((entry) => entry.summary))),
		});
		// "匹配到几份"只在搜索时出现：没有搜索词时它和上面的合计说的是同一件事。
		this.matchedEl = body.createDiv({ cls: "easy-quiz-practice__matched" });
		this.updateMatchedNote();

		const list = body.createDiv({ cls: "easy-quiz-practice__files" });
		this.fillList(list);

		this.renderListFooter(body);
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
			this.setQuery("");
			void this.render();
		});

		const { matched } = this.visible();

		const all = this.button(toolbar, "select-all", t("practice.toolbar.selectAll"));
		all.disabled = !matched.some((entry) => entry.summary.answerable > 0);
		all.addEventListener("click", () => {
			// 候选项在点击时才取：搜索词可能已经变过，渲染时算好的那份会过期。
			const usable = this.visible().matched.filter((entry) => entry.summary.answerable > 0);
			this.picked = [...new Set([...this.picked, ...usable.map((entry) => entry.file.path)])];
			void this.render();
		});

		const clear = this.button(toolbar, "clear-selection", t("practice.toolbar.clear"));
		clear.disabled = this.picked.length === 0;
		clear.addEventListener("click", () => {
			this.picked = [];
			void this.render();
		});

		const foldAll = this.button(toolbar, "fold-all", t("practice.list.foldAll"));
		foldAll.disabled = entries.length === 0;
		foldAll.addEventListener("click", () => {
			this.folded = new Set((this.entries ?? []).map((entry) => entry.summary.folder));
			void this.render();
		});

		const unfoldAll = this.button(toolbar, "unfold-all", t("practice.list.unfoldAll"));
		unfoldAll.disabled = this.folded.size === 0;
		unfoldAll.addEventListener("click", () => {
			this.folded = new Set();
			void this.render();
		});

		const rescan = this.button(toolbar, "rescan", t("practice.toolbar.rescan"));
		rescan.addEventListener("click", () => {
			this.entries = null;
			this.stale = true;
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
			this.redrawList();
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
			this.entries = null;
			this.stale = true;
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
			row.toggleClass("is-picked", check.checked);
			this.syncToolbar();
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

	/** 勾选变化后就地更新底部操作条与各文件夹的整组勾选框。 */
	private syncToolbar(): void {
		if (this.startEl !== null) this.startEl.disabled = this.picked.length === 0;
		if (this.footerTextEl !== null) this.footerTextEl.setText(this.pickerLabel());
		const clear = this.bodyEl?.querySelector("button[data-action='clear-selection']") ?? null;
		if (this.isButton(clear)) clear.disabled = this.picked.length === 0;
		this.syncFolderChecks();
	}

	/**
	 * 让每个文件夹标题上的勾选框反映组内状态。
	 *
	 * 单个文件被勾上/取消时要一起更新：整组全选、全不选、部分选中（半勾）是三种不同的样子，
	 * 漏掉这一步就会出现"组里明明全勾了，标题上还是半勾"的错觉。
	 *
	 * 按渲染顺序一一对应，而不是用选择器按文件夹名去找：文件夹名可能带引号或反斜杠，
	 * 拼进选择器就要额外转义，不如让分组自己带着勾选框。
	 */
	private syncFolderChecks(): void {
		const checks = this.bodyEl?.querySelectorAll(".easy-quiz-practice__group") ?? [];
		this.visible().groups.forEach((group, index) => {
			const wrapper = checks[index];
			const check = wrapper?.querySelector<HTMLInputElement>("input[data-action='pick-folder']") ?? null;
			if (check === null || check === undefined) return;
			const usable = group.entries.filter((entry) => entry.summary.answerable > 0);
			const selected = usable.filter((entry) => this.picked.includes(entry.file.path)).length;
			check.checked = usable.length > 0 && selected === usable.length;
			check.indeterminate = selected > 0 && selected < usable.length;
		});
	}

	private gotoPicker(): void {
		this.page = 1;
		void this.render();
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

		await this.loadParsed();
		if (this.page !== 1 || this.bodyEl !== body) return;

		this.heading(t("practice.picker.heading"), t("practice.picker.hint"));

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

		// 三个设置行合成一张卡片：视觉上是一组"这一轮怎么抽题"的决定。
		const panel = body.createDiv({ cls: "easy-quiz-practice__panel" });
		this.renderModeSetting(panel);
		this.renderTypeSetting(panel);
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

		// 本轮写回过记录：重新解析，成绩与题面才是最新的。
		await this.loadParsed();
		if (this.page !== 2 || this.bodyEl !== body) return;

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
			// 「打乱顺序」开关也作用于选择题的选项顺序（题目自己写的 shuffle: true 同样生效）。
			shuffleOptions: this.config.shuffleOptions,
			shuffleSeed: this.sessionSeed,
			// 复盘态由窗口控制：提交后由 renderQuizCard 自己把答案摊在卡片里。
			reviewOnly: this.reviewing,
			// 题卡里的 Markdown 子组件（图片、嵌入块）交给本视图托管，窗口关闭或换题时卸载。
			addRenderChild: (child) => {
				this.addChild(child);
				this.cardComponents.push(child);
			},
			onSubmitted: (result) => {
				// 一道题只计一次分：复盘重渲染不会再改分。
				if (this.results[this.cursor] === null) this.results[this.cursor] = result.correct;
				this.dirty = true;
				this.afterSubmit(host, result);
			},
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

		if (this.queue.length > 3) {
			const jump = nav.createEl("input", { cls: "easy-quiz-practice__jump" });
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
