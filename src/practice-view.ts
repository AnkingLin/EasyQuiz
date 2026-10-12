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

import { ItemView, Notice, Setting, TFile, WorkspaceLeaf } from "obsidian";
import { QuizService, RuntimeSettings } from "./runtime";
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
import { CardContext, renderQuizCard, typeLabel } from "./view";

export const PRACTICE_VIEW_TYPE = "easy-quiz-practice";

/** 顶部三步指示里的步骤名。 */
const STEPS = ["题库列表", "刷题设置", "刷题"] as const;

/** 模式按钮文案。 */
const MODE_LABELS: Record<PracticeMode, string> = {
	order: "顺序刷题",
	random: "定量随机抽题",
	wrong: "只刷错题",
};

const MODE_HINTS: Record<PracticeMode, string> = {
	order: "按文件里的题目顺序逐题过一遍，适合系统复习。",
	random: "从候选题里随机抽出指定数量，留空或填 0 表示全部。",
	wrong: "只抽上一次作答错误的题。没有记录时这一轮会是空的。",
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

/** 当前页面：0 题库列表 / 1 刷题设置 / 2 刷题。 */
type Page = 0 | 1 | 2;

export class PracticeView extends ItemView {
	private host: EasyQuizHost;
	private openSettings: () => void;

	/** 当前页面。 */
	private page: Page = 0;
	/** 题库列表的缓存；null 表示还没扫过。 */
	private entries: FileEntry[] | null = null;
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
	/** 题卡自身的资源回收（例如配对题的尺寸观察者）。 */
	private cardCleanups: (() => void)[] = [];

	/** 页面骨架。 */
	private rootEl: HTMLElement | null = null;
	private navEl: HTMLElement | null = null;
	private bodyEl: HTMLElement | null = null;
	/** 刷题页里需要原地更新的部分：只重画它们，避免整页重画。 */
	private cardHost: HTMLElement | null = null;
	private progressEl: HTMLElement | null = null;
	private countEl: HTMLElement | null = null;
	private startEl: HTMLButtonElement | null = null;

	constructor(leaf: WorkspaceLeaf, host: EasyQuizHost, openSettings: () => void) {
		super(leaf);
		this.host = host;
		this.openSettings = openSettings;
	}

	getViewType(): string {
		return PRACTICE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "刷题";
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
				text: `刷题窗口渲染失败：${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}

	/** 顶部的三步指示，同时充当"往回走一步"的入口。 */
	private renderSteps(): void {
		const nav = this.navEl;
		if (nav === null) return;
		nav.empty();

		for (const [index, label] of STEPS.entries()) {
			const current = index === this.page;
			const step = nav.createDiv({
				cls: `easy-quiz-practice__step${current ? " is-current" : ""}${index < this.page ? " is-done" : ""}`,
			});
			step.createSpan({ cls: "easy-quiz-practice__step-no", text: String(index + 1) });
			step.createSpan({ cls: "easy-quiz-practice__step-label", text: label });

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

		this.heading(
			"题库文件",
			"按文件路径列出 vault 里的题库文件及其数据。勾选多份可以合并成一轮练习。"
		);
		const loading = body.createDiv({ cls: "easy-quiz-practice__loading", text: "正在扫描题库…" });

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

		const list = body.createDiv({ cls: "easy-quiz-practice__files" });
		let folder: string | null = null;
		for (const entry of entries) {
			if (entry.summary.folder !== folder) {
				folder = entry.summary.folder;
				list.createDiv({
					cls: "easy-quiz-practice__folder",
					text: folder === "" ? "/（vault 根目录）" : `/${folder}`,
				});
			}
			this.renderFileRow(list, entry);
		}
	}

	private totalsText(totals: SummaryTotals): string {
		const rate = totals.attempts === 0 ? "—" : `${Math.round((totals.correct / totals.attempts) * 100)}%`;
		return [
			`${totals.files} 个题库文件`,
			`${totals.questions} 道题`,
			`可作答 ${totals.answerable}`,
			`需修正 ${totals.broken}`,
			`已作答 ${totals.attempts} 次`,
			`正确率 ${rate}`,
		].join(" · ");
	}

	private renderListToolbar(body: HTMLElement, entries: FileEntry[]): void {
		const toolbar = body.createDiv({ cls: "easy-quiz-practice__toolbar" });
		const usable = entries.filter((entry) => entry.summary.answerable > 0);

		const all = this.button(toolbar, "select-all", "全选可作答");
		all.disabled = usable.length === 0;
		all.addEventListener("click", () => {
			this.picked = usable.map((entry) => entry.file.path);
			void this.render();
		});

		const clear = this.button(toolbar, "clear-selection", "清空选择");
		clear.disabled = this.picked.length === 0;
		clear.addEventListener("click", () => {
			this.picked = [];
			void this.render();
		});

		const rescan = this.button(toolbar, "rescan", "重新扫描");
		rescan.addEventListener("click", () => {
			this.entries = null;
			this.stale = true;
			void this.render();
		});

		const start = this.button(toolbar, "to-picker", this.pickerLabel(), true);
		start.disabled = this.picked.length === 0;
		start.addEventListener("click", () => this.gotoPicker());

		// 行内勾选后只更新这几个按钮的字样与可用状态，避免整页重画导致勾选闪动。
		this.startEl = start;
		this.countEl = null;
	}

	private pickerLabel(): string {
		return `开始设置（已选 ${this.picked.length} 份）`;
	}

	private renderEmpty(body: HTMLElement): void {
		const empty = body.createDiv({ cls: "easy-quiz-practice__empty" });
		empty.createDiv({ text: "没有找到题库文件。" });
		const hints = empty.createEl("ul", { cls: "easy-quiz-practice__empty-hints" });
		hints.createEl("li", { text: "在笔记的 frontmatter 里写 quiz: true（推荐）。" });
		hints.createEl("li", { text: "或者给文件加 #quiz 标签。" });
		hints.createEl("li", { text: "或者在设置里的「题库路径通配符」中加上路径，例如 题库/**。" });

		const open = this.button(empty, "open-settings", "打开设置");
		open.addEventListener("click", () => this.openSettings());
		const rescan = this.button(empty, "rescan", "重新扫描");
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
			main.createDiv({ cls: "easy-quiz-practice__file-error", text: `解析失败：${entry.error}` });
		} else if (summary.issues > 0) {
			main.createDiv({
				cls: "easy-quiz-practice__file-error",
				text: `有 ${summary.issues} 处需要修正，这些题不会进入练习。`,
			});
		}

		const pick = this.button(row, "pick-file-only", "设置刷题");
		pick.dataset["path"] = summary.path;
		pick.disabled = summary.answerable === 0;
		pick.addEventListener("click", () => {
			this.picked = [summary.path];
			this.gotoPicker();
		});
	}

	private fileStatsText(entry: FileEntry): string {
		const summary = entry.summary;
		const parts = [`共 ${summary.total} 题`, `可作答 ${summary.answerable}`];
		if (summary.broken > 0) parts.push(`需修正 ${summary.broken}`);
		if (summary.attempts > 0) {
			parts.push(`已作答 ${summary.attempts} 次`, `正确率 ${Math.round((summary.correct / summary.attempts) * 100)}%`);
		} else {
			parts.push("无记录");
		}
		if (summary.lastAt !== null) parts.push(`最近 ${summary.lastAt.slice(0, 10)}`);
		return parts.join(" · ");
	}

	private isButton(el: Element | null): el is HTMLButtonElement {
		// jsdom / 测试环境不一定会挂全局 HTMLButtonElement，因此按能力判断而不是 instanceof。
		return el !== null && typeof (el as { disabled?: unknown }).disabled === "boolean";
	}

	/** 勾选变化后就地更新底部按钮。 */
	private syncToolbar(): void {
		if (this.startEl !== null) {
			this.startEl.setText(this.pickerLabel());
			this.startEl.disabled = this.picked.length === 0;
		}
		const clear = this.bodyEl?.querySelector("button[data-action='clear-selection']") ?? null;
		if (this.isButton(clear)) clear.disabled = this.picked.length === 0;
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
	 */
	private async loadParsed(force = false): Promise<void> {
		const reparse = force || this.stale;
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
			this.heading("刷题设置", "还没有选择题库文件。");
			const back = this.button(body, "goto-list", "返回题库列表", true);
			back.addEventListener("click", () => {
				this.page = 0;
				void this.render();
			});
			return;
		}

		await this.loadParsed();
		if (this.page !== 1 || this.bodyEl !== body) return;

		this.heading("刷题设置", "选择练什么、怎么抽题。开始前会先告诉你这一轮有多少道题。");

		const files = body.createDiv({ cls: "easy-quiz-practice__picked" });
		for (const path of this.picked) {
			const chip = files.createDiv({ cls: "easy-quiz-practice__chip" });
			const parsed = this.parsedByPath.get(path);
			const count = parsed === undefined ? 0 : parsed.questions.filter((question) => question.ok).length;
			chip.createSpan({ text: `${path}（可作答 ${count}）` });
			const remove = chip.createEl("button", { text: "✕" });
			remove.setAttribute("aria-label", `移除 ${path}`);
			remove.dataset["action"] = "unpick-file";
			remove.dataset["path"] = path;
			remove.addEventListener("click", () => {
				this.picked = this.picked.filter((item) => item !== path);
				this.parsedByPath.delete(path);
				void this.render();
			});
		}

		this.renderModeSetting(body);
		this.renderTypeSetting(body);
		this.renderShuffleSetting(body);
		this.renderStartRow(body);
		this.refreshCounts();
	}

	/** 抽题方式：三个互斥按钮 + 随机模式的数量输入。 */
	private renderModeSetting(body: HTMLElement): void {
		const setting = new Setting(body).setName("抽题方式").setDesc(MODE_HINTS[this.config.mode]);
		setting.settingEl.addClass("easy-quiz-practice__setting");

		const group = setting.controlEl.createDiv({ cls: "easy-quiz-practice__modes" });
		for (const mode of MODES) {
			const button = group.createEl("button", { text: MODE_LABELS[mode] });
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

		setting.addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = "0";
			text.inputEl.dataset["action"] = "random-count";
			text.setValue(String(this.config.randomCount));
			text.setDisabled(this.config.mode !== "random");
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
			.setName("题型")
			.setDesc("不勾选任何题型表示不限题型；括号里是当前文件里的可作答题数。");
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
			label.createSpan({ text: `${typeLabel(type)}（${counts[type]}）` });
		}
	}

	private renderShuffleSetting(body: HTMLElement): void {
		const setting = new Setting(body)
			.setName("打乱顺序")
			.setDesc("打乱出题顺序与选择题的选项顺序；配对题的每一列始终会打乱。");
		setting.settingEl.addClass("easy-quiz-practice__setting");
		setting.addToggle((toggle) =>
			toggle.setValue(this.config.shuffleOptions).onChange((value) => {
				this.config.shuffleOptions = value;
			})
		);
	}

	private renderStartRow(body: HTMLElement): void {
		const row = body.createDiv({ cls: "easy-quiz-practice__start" });
		this.countEl = row.createDiv({ cls: "easy-quiz-practice__count" });
		this.countEl.dataset["action"] = "session-count";
		this.startEl = this.button(row, "start-session", "开始刷题", true);
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
				`选中文件可作答 ${this.availableCount()} 题`,
				`符合当前条件 ${candidates} 题`,
				`这一轮将刷 ${planned} 题`,
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
			new Notice("当前条件下没有可刷的题：换一种题型或抽题方式试试。");
			return;
		}

		this.queue = queue;
		this.cursor = 0;
		this.results = this.queue.map(() => null);
		this.reviewing = false;
		this.finished = false;
		this.dirty = false;
		this.page = 2;
		await this.render();
	}

	private async renderSession(): Promise<void> {
		const body = this.bodyEl;
		if (body === null) return;

		if (this.queue.length === 0) {
			this.heading("刷题", "这一轮已经结束。");
			const back = this.button(body, "goto-list", "回到题库列表", true);
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
		head.createEl("h3", { cls: "easy-quiz-practice__title", text: "刷题" });
		const toolbar = head.createDiv({ cls: "easy-quiz-practice__toolbar" });
		const end = this.button(toolbar, "end-session", "结束本轮");
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
			text: `第 ${Math.min(this.cursor + 1, this.queue.length)} / ${this.queue.length} 题`,
		});
		head.createSpan({ cls: "easy-quiz-practice__progress-title", text: entry?.title ?? "" });
		head.createSpan({
			cls: "easy-quiz-practice__progress-count",
			text: `对 ${progress.correct} · 错 ${progress.wrong} · 已答 ${progress.answered}`,
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
				text: "这道题已不存在（文件或题面被改动过）。跳过它，或重新开始一轮。",
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
			// 复盘态由窗口控制：提交后由 renderQuizCard 自己把答案摊在卡片里。
			reviewOnly: this.reviewing,
			onSubmitted: (result) => {
				// 一道题只计一次分：复盘重渲染不会再改分。
				if (this.results[this.cursor] === null) this.results[this.cursor] = result.correct;
				this.dirty = true;
				this.afterSubmit(host);
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
				text: `题卡渲染失败：${error instanceof Error ? error.message : String(error)}`,
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
	private afterSubmit(host: HTMLElement): void {
		for (const button of Array.from(host.querySelectorAll(".easy-quiz-card__actions button"))) {
			(button as HTMLButtonElement).disabled = true;
			button.addClass("is-hidden");
		}
		this.reviewing = true;
		this.renderProgress();
		this.renderNav(host);
	}

	/** 上一题 / 下一题 / 查看解析 / 跳题。 */
	private renderNav(host: HTMLElement): void {
		for (const existing of Array.from(host.querySelectorAll(".easy-quiz-practice__nav"))) existing.detach();
		const nav = host.createDiv({ cls: "easy-quiz-practice__nav" });

		const prev = this.button(nav, "prev-question", "上一题");
		prev.disabled = this.cursor === 0;
		prev.addEventListener("click", () => {
			void this.goTo(this.cursor - 1);
		});

		const last = this.cursor >= this.queue.length - 1;
		const next = this.button(nav, "next-question", last ? "查看本轮结果" : "下一题", true);
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
			const peek = this.button(nav, "peek", "查看解析");
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
			jump.setAttribute("aria-label", "跳到第几题");
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
		panel.createDiv({ cls: "easy-quiz-practice__summary-title", text: "本轮结果" });
		panel.createDiv({
			cls: "easy-quiz-practice__summary-line",
			text: `共 ${this.queue.length} 题 · 已作答 ${answered} · 正确 ${progress.correct} · 错误 ${progress.wrong} · 正确率 ${rate}%`,
		});
		if (this.dirty && !this.host.settings.writeBackEnabled) {
			panel.createDiv({
				cls: "easy-quiz-practice__hint",
				text: "当前设置关闭了记录写回，本轮成绩没有写入笔记。",
			});
		}

		const wrongEntries = this.queue.filter((_, index) => this.results[index] === false);
		if (wrongEntries.length > 0) {
			const list = panel.createDiv({ cls: "easy-quiz-practice__wrong" });
			list.createDiv({ cls: "easy-quiz-practice__summary-sub", text: "本轮答错的题" });
			for (const entry of wrongEntries) {
				list.createDiv({ cls: "easy-quiz-practice__wrong-item", text: `${entry.title}（/${entry.path}）` });
			}
		}

		const actions = panel.createDiv({ cls: "easy-quiz-practice__toolbar" });
		const again = this.button(actions, "restart-session", "再刷一轮", true);
		again.addEventListener("click", () => {
			void this.restart();
		});

		const retryWrong = this.button(actions, "retry-wrong", "只重做错题");
		retryWrong.disabled = wrongEntries.length === 0;
		retryWrong.addEventListener("click", () => {
			this.queue = wrongEntries;
			this.cursor = 0;
			this.results = this.queue.map(() => null);
			this.reviewing = false;
			this.finished = false;
			void this.render();
		});

		const back = this.button(actions, "goto-list", "回到题库列表");
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
