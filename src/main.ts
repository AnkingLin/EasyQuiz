import {
	debounce,
	Editor,
	MarkdownFileInfo,
	MarkdownPostProcessorContext,
	MarkdownView,
	Menu,
	moment,
	Notice,
	Platform,
	Plugin,
	TFile,
} from "obsidian";
import type { WorkspaceLeaf } from "obsidian";
import { ParsedQuizFile, QuizQuestion } from "./types";
import { QuizService } from "./runtime";
import { parseSettingsSignature, sanitizeSettings } from "./settings";
import type { RuntimeSettings } from "./settings";
import { setLanguage, resolveLanguage, t } from "./i18n";
import { renderQuizCard } from "./view";
import { insertQuestionAtCursor, InsertQuestionOptions } from "./insert-modal";
import { registerFileMenu } from "./file-menu";
import { placementOf } from "./practice-placement";
import {
	buildReferenceIndex,
	parseReferenceId,
	pickReference,
	ReferenceBank,
	QuestionReferenceTarget,
} from "./reference";
import type { PracticePlacement } from "./practice-placement";
import { PRACTICE_VIEW_TYPE, PracticeView } from "./practice-view";
import { openQuestionSource } from "./source-note";
import { findQuestion } from "./quiz-lookup";
import { rerenderPreviewPreservingScroll } from "./preview-refresh";
import { shouldAnnounce, whatsNewFor } from "./whats-new";
import { EasyQuizSettingTab } from "./settings-tab";
import { WhatsNewModal } from "./whats-new-modal";

/**
 * 题卡内部不再套题卡：题面渲染时会再跑一遍后处理器，
 * 若题面里又写了题目引用就会无限递归，用 DOM 位置直接掐断。
 */
function isInsideQuizCard(el: HTMLElement): boolean {
	return el.closest(".easy-quiz-card") !== null;
}

/**
 * 界面语言的候选来源，按可信度排序。
 *
 * 首选 `moment.locale()`：Obsidian 会按「设置 → 关于 → 语言」设置它，因此它就是
 * 用户选的语言，而且 1.4 起就有。没有用它旁边的 `getLanguage()`，是因为那个 API
 * 要 1.8.7 才提供，而本插件声明的 minAppVersion 是 1.4.0——为了一个语言探测把
 * 最低版本抬高三年的跨度不值得。文档语言与浏览器语言只在拿不到 moment 时兜底。
 */
function languageSources(): (string | null)[] {
	const sources: (string | null)[] = [];
	if (typeof moment?.locale === "function") sources.push(moment.locale());
	if (typeof document !== "undefined") sources.push(document.documentElement.lang);
	if (typeof navigator !== "undefined") sources.push(navigator.language);
	return sources;
}

/** data.json 的形状：设置之外还存着「更新提示已经展示到哪一版」。 */
interface StoredData extends Partial<RuntimeSettings> {
	/** 旧版本的数据里没有这个字段，读出来可能是任何东西。 */
	whatsNewSeen?: unknown;
}

export default class EasyQuizPlugin extends Plugin {
	// 两者都在 onload 中先于任何注册动作完成初始化。
	settings!: RuntimeSettings;
	service!: QuizService;
	/** 已经提示过更新内容的版本；null 表示还没有记录。 */
	private whatsNewSeen: string | null = null;
	/** `` `题目id` `` 引用索引；题库文件变动时清空，下次渲染重建。 */
	private referenceIndex: Map<string, QuestionReferenceTarget[]> | null = null;
	/** 正在构建的引用索引；同一轮渲染里多个引用共用一次整库扫描。 */
	private referenceIndexTask: Promise<Map<string, QuestionReferenceTarget[]>> | null = null;
	/** 索引代数：构建期间失效的旧结果不能再写回缓存。 */
	private referenceGeneration = 0;
	/** 插件自己刚写回的文件 → 时间戳；跳过由此触发的预览重渲染，保住复盘。 */
	private selfWrites = new Map<string, number>();
	/** 上次保存时与解析有关的设置指纹；变化时让缓存与已渲染题卡失效。 */
	private lastParseSignature = "";
	/** 初始的元数据解析是否已经补画过一次；`resolved` 之后每次编辑都会再触发。 */
	private initialCacheResolved = false;

	async onload() {
		await this.loadSettings();
		// 语言要先定下来：下面的命令名、丝带提示、设置页文案都要用当前语言。
		this.applyLanguage();
		this.service = new QuizService(this.app, this.settings, undefined, (file) => {
			this.noteSelfWrite(file.path);
		});

		// 刷题窗口：题库列表 / 刷题设置 / 刷题三个页面都在这个自定义视图里。
		this.registerView(PRACTICE_VIEW_TYPE, (leaf) => {
			return new PracticeView(leaf, this, () => this.openPluginSettings());
		});

		// 题库文件中的数据块由这里渲染成刷题界面。
		// 阅读视图/预览中渲染；实时预览下光标进入会还原为源码，属 Obsidian 的既定行为。
		this.registerMarkdownCodeBlockProcessor(
			this.settings.blockLanguage,
			async (source, el, ctx) => {
				await this.renderBlock(source, el, ctx);
			}
		);

		// 题目引用：`` `题目id` `` 内联代码在笔记里就地渲染成可作答的题卡。
		// 原生嵌入 `![[...]]` 一律交给 Obsidian 自己渲染，插件不接管。
		this.registerMarkdownPostProcessor((el, ctx) => this.renderReferences(el, ctx), -10);

		// 题目被编辑后，阅读视图里的数据块不会自动重渲染，需要手动刷新一次。
		// 刷题窗口同样缓存了解析结果，一并标脏。
		const refresh = debounce((file: TFile) => this.refreshPreviews(file), 150, true);
		this.registerEvent(
			this.app.metadataCache.on("changed", (file) => {
				if (this.isQuizPath(file.path)) refresh(file);
			})
		);
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (file instanceof TFile && this.isQuizPath(file.path)) refresh(file);
			})
		);
		// 元数据缓存就绪前建立的引用索引可能是空表：缓存建好后清掉并补画一次。
		// 注意 `resolved` 在初始加载后**每次文件修改都会再触发**（见 obsidian.d.ts），
		// 因此只有第一次能重画全部笔记；后续编辑只让索引失效，否则会把分屏
		// 另一侧的阅读视图也重画并滚回开头。
		this.registerEvent(
			this.app.metadataCache.on("resolved", () => {
				this.invalidateReferences();
				if (this.initialCacheResolved) return;
				this.initialCacheResolved = true;
				this.refreshNotes();
			})
		);
		// 删除/重命名题库文件后，已有引用与刷题窗口的缓存都要失效。
		this.registerEvent(this.app.vault.on("delete", () => this.handleVaultChange()));
		this.registerEvent(this.app.vault.on("rename", () => this.handleVaultChange()));

		this.addCommand({
			id: "refresh-quiz-view",
			name: t("command.refresh"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.refreshPreviews(file, true);
				return true;
			},
		});

		this.addCommand({
			id: "validate-quiz-file",
			name: t("command.validate"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.validateFile(file);
				return true;
			},
		});

		this.addCommand({
			id: "open-practice-window",
			name: t("command.openPractice"),
			callback: () => {
				void this.openPracticeView("sidebar");
			},
		});

		this.addCommand({
			id: "open-practice-tab",
			name: t("command.openPracticeTab"),
			callback: () => {
				void this.openPracticeView("tab");
			},
		});

		// 弹出窗口只有桌面端有；移动端干脆不把这个命令注册出来，免得点了没反应。
		this.addCommand({
			id: "open-practice-popout",
			name: t("command.openPracticePopout"),
			checkCallback: (checking) => {
				if (Platform.isMobileApp) return false;
				if (!checking) void this.openPracticeView("popout");
				return true;
			},
		});

		// 「刷这个题库」：命令面板里直接对当前笔记开一轮，不必先进列表再勾选。
		this.addCommand({
			id: "practice-active-quiz",
			name: t("command.practiceQuiz"),
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file === null || !this.service.isQuizFile(file)) return false;
				if (!checking) void this.practiceActiveQuiz(file);
				return true;
			},
		});

		this.addRibbonIcon("graduation-cap", t("command.openPractice"), () => {
			void this.openPracticeView("sidebar");
		});

		this.addCommand({
			id: "insert-question",
			name: t("command.insert"),
			editorCheckCallback: (checking, editor) => {
				if (!checking) this.insertQuestion(editor);
				return true;
			},
		});

		// 编辑区右键菜单：与命令共用同一套插入逻辑，只在有编辑器的 md 视图里出现。
		this.registerEvent(
			this.app.workspace.on("editor-menu", (menu, editor, info) => {
				this.addInsertMenuItem(menu, editor, info);
			})
		);

		// 文件浏览器里的「更多选项」菜单：题库文件多一个「刷这个题库」入口。
		registerFileMenu(this.app.workspace, this, (ref) => this.registerEvent(ref));

		this.addSettingTab(new EasyQuizSettingTab(this.app, this));

		// 更新后只提示一次这一版的改动。等布局就绪再弹，避免和启动时的界面绘制抢一步。
		this.app.workspace.onLayoutReady(() => {
			void this.announceWhatsNew();
		});
	}

	/** 对话框所需的设置项；题型标题层级与数据块语言都跟随设置。 */
	private insertOptions(): InsertQuestionOptions {
		return {
			headingLevel: this.settings.headingLevels[0],
			blockLanguage: this.settings.blockLanguage,
			blankMarker: this.settings.blankMarker,
		};
	}

	/** 打开「插入题目」对话框，确认后在光标处写入题目骨架。 */
	private insertQuestion(editor: Editor): void {
		insertQuestionAtCursor(this.app, editor, this.insertOptions());
	}

	private addInsertMenuItem(menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo): void {
		// 只有 Markdown 笔记里插入才有意义（画布、PDF 等视图也会触发该事件）。
		if (!(info.file instanceof TFile) || info.file.extension !== "md") return;
		menu.addItem((item) =>
			item
				.setTitle(t("menu.insert"))
				.setIcon("circle-plus")
				.onClick(() => this.insertQuestion(editor))
		);
	}

	onunload() {
		// 索引/写回标记只是内存缓存；显式释放，避免重新加载后残留大对象。
		this.invalidateReferences();
		this.selfWrites.clear();
	}

	/**
	 * 更新后提示一次这一版的改动。
	 *
	 * 版本记录与设置存在同一份 data.json 里，因此不需要额外文件。先记版本再弹窗：
	 * 用户马上关掉也不会每次加载都再弹一次。没有为当前版本写更新内容时保持安静，
	 * 不会升级后只看到一个空对话框。
	 */
	private async announceWhatsNew(): Promise<void> {
		const current = this.manifest.version;
		if (this.whatsNewSeen === current) return;

		const previous = this.whatsNewSeen;
		this.whatsNewSeen = current;
		try {
			await this.saveSettings();
		} catch (error) {
			// 写盘失败不该挡住提示；下次加载会重新尝试。
			console.error("EasyQuiz: could not save the What's New marker", error);
		}

		if (!shouldAnnounce(previous, current)) return;
		const entry = whatsNewFor(current);
		if (entry !== null) new WhatsNewModal(this.app, entry).open();
	}

	/**
	 * 打开（或聚焦）刷题窗口。
	 *
	 * `where` 决定开在哪里：
	 *  - `sidebar`：右侧边栏，命令与丝带图标的默认位置；
	 *  - `tab`：主区域的新标签页；
	 *  - `popout`：独立的弹出窗口（仅桌面端）。
	 *
	 * Obsidian 没有"单例视图"的开关：同一个位置只留一个刷题视图——已经开着就地
	 * 切回来，避免连点命令开出好几个。不同位置互不影响，因此可以同时开着一个
	 * 侧边栏窗和一个标签页。
	 * 这里刻意不调用 `revealLeaf`（Obsidian 1.7.2 起才有），
	 * 以保持 manifest 里声明的最低版本；`active: true` 已能让叶子显示出来。
	 */
	private async openPracticeView(where: PracticePlacement = "sidebar"): Promise<void> {
		const leaf = this.practiceLeafAt(where) ?? this.newPracticeLeaf(where);
		if (leaf === null) return;
		await leaf.setViewState({ type: PRACTICE_VIEW_TYPE, active: true });
		const view = leaf.view;
		if (view instanceof PracticeView) await view.activate();
	}

	/** 找已经开在指定位置的刷题视图；没有就返回 null。 */
	private practiceLeafAt(where: PracticePlacement): WorkspaceLeaf | null {
		for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_VIEW_TYPE)) {
			if (placementOf(leaf.view.containerEl, document) === where) return leaf;
		}
		return null;
	}

	/** 在指定位置新建一个刷题视图的叶子。 */
	private newPracticeLeaf(where: PracticePlacement): WorkspaceLeaf | null {
		const workspace = this.app.workspace;
		if (where === "sidebar") return workspace.getRightLeaf(false);
		return workspace.getLeaf(where === "popout" ? "window" : "tab");
	}

	/**
	 * 打开刷题窗口并直接进入某个题库的刷题设置页（文件菜单的入口）。
	 *
	 * 复用任一个已经打开的刷题视图：已经有窗口就地切换页面，
	 * 没有才在右侧边栏新建一个，避免从文件菜单点几下就开出好几个窗口。
	 */
	async openPracticeFor(path: string): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(PRACTICE_VIEW_TYPE);
		const leaf = existing[0] ?? this.newPracticeLeaf("sidebar");
		if (leaf === null) return;
		await leaf.setViewState({ type: PRACTICE_VIEW_TYPE, active: true });
		const view = leaf.view;
		if (view instanceof PracticeView) await view.openPickerFor(path);
	}

	/**
	 * 命令「刷这个题库」：对当前文件直接开一轮练习。
	 *
	 * 与文件菜单的 `openPracticeFor` 不同，这里跳过刷题设置页；
	 * 侧边栏里已经有刷题视图时复用它，避免一个命令开出好几个窗口。
	 */
	private async practiceActiveQuiz(file: TFile): Promise<void> {
		const leaf = this.practiceLeafAt("sidebar") ?? this.newPracticeLeaf("sidebar");
		if (leaf === null) return;
		await leaf.setViewState({ type: PRACTICE_VIEW_TYPE, active: true });
		const view = leaf.view;
		if (view instanceof PracticeView) await view.practiceFile(file.path);
	}

	/** 让设置页定位到本插件（视图里的「打开设置」按钮）。 */
	private openPluginSettings(): void {
		const setting = (this.app as unknown as { setting?: { open(): void; openTabById(id: string): void } }).setting;
		setting?.open();
		setting?.openTabById(this.manifest.id);
	}

	/** 当前打开的刷题窗口（可能不止一个，逐个通知）。 */
	private practiceViews(): PracticeView[] {
		const views: PracticeView[] = [];
		for (const leaf of this.app.workspace.getLeavesOfType(PRACTICE_VIEW_TYPE)) {
			if (leaf.view instanceof PracticeView) views.push(leaf.view);
		}
		return views;
	}

	/** 该路径是否可能是题库文件（用于限制刷新范围，避免无谓重渲染）。 */
	private isQuizPath(path: string): boolean {
		const file = this.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) return this.service.isQuizFile(file);
		return false;
	}

	/**
	 * 让阅读视图重新渲染指定文件的数据块。
	 *
	 * 只有当前正在阅读视图里显示的笔记才需要刷新；`force` 为 true 时用于手动刷新命令。
	 */
	private refreshPreviews(file: TFile, force = false): void {
		// 题目内容可能变了，id → 题目的索引也随之失效。
		this.invalidateReferences();
		// 只把改过的那一份标脏：刷题窗口的列表刷新因此只需重解析它。
		for (const view of this.practiceViews()) view.markStale(file.path);
		// 写回本身也会触发 modify/changed。此时整页重渲染会把刚显示的复盘与作答
		// 一起抹掉，因此插件自己写过的文件只更新缓存，不动阅读视图。
		if (!force && this.wasSelfWrite(file.path)) return;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.file?.path !== file.path) continue;
			if (!force && view.getMode() !== "preview") continue;
			rerenderPreviewPreservingScroll(view);
		}
	}

	/** 记录一次插件自己的写回；短时间内的文件变更事件据此跳过整页重渲染。 */
	private noteSelfWrite(path: string): void {
		const now = Date.now();
		this.selfWrites.set(path, now);
		if (this.selfWrites.size <= 50) return;
		for (const [key, at] of this.selfWrites) {
			if (now - at > 10_000) this.selfWrites.delete(key);
		}
	}

	private wasSelfWrite(path: string): boolean {
		const at = this.selfWrites.get(path);
		return at !== undefined && Date.now() - at < 2_000;
	}

	/** 题库文件被删除/重命名：引用索引与刷题窗口缓存一起失效。 */
	private handleVaultChange(): void {
		this.invalidateReferences();
		for (const view of this.practiceViews()) view.markStale();
		this.refreshNotes();
	}

	/** 渲染一个数据块：先解析整份文件，再把数据块对应到具体题目。 */
	private async renderBlock(
		source: string,
		el: HTMLElement,
		post: MarkdownPostProcessorContext
	): Promise<void> {
		const sourcePath = post.sourcePath;
		const section = post.getSectionInfo(el);
		el.empty();
		el.addClass("easy-quiz-block");

		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) {
			el.createDiv({ cls: "easy-quiz-card is-diagnostic", text: t("diagnostic.fileNotFound") });
			return;
		}
		if (!this.service.isQuizFile(file)) {
			// 不是题库文件：保持普通代码块的样子，避免误渲染。
			renderPlainBlock(source, el);
			return;
		}

		let parsed: ParsedQuizFile;
		try {
			parsed = await this.service.parseFile(file);
		} catch (error) {
			el.createDiv({
				cls: "easy-quiz-card is-diagnostic",
				text: t("diagnostic.parseFailed", {
					error: error instanceof Error ? error.message : String(error),
				}),
			});
			return;
		}

		const question = findQuestion(parsed, section, source);
		if (!question) {
			el.createDiv({
				cls: "easy-quiz-card is-diagnostic",
				text: t("diagnostic.blockOutsideStem"),
			});
			return;
		}

		await renderQuizCard(question, {
			app: this.app,
			service: this.service,
			file,
			el,
			blockLine: question.blockLine ?? undefined,
			blankMarker: this.settings.blankMarker,
			showStaleHint: this.settings.showStaleHint,
			writeBackEnabled: this.settings.writeBackEnabled,
			onDismissStaleHint: () => this.dismissStaleHint(),
			onOpenSource: () => void openQuestionSource(this.app, file, question),
			// MarkdownRenderer 需要一个 Component 承载生命周期；交给渲染上下文托管。
			addRenderChild: (child) => post.addChild(child),
			onSubmitted: (result) => this.refreshNotice(result.written),
		});
	}

	private refreshNotice(written: boolean | undefined): void {
		new Notice(t(written === false ? "notice.notSaved" : "notice.recorded"));
	}

	// -----------------------------------------------------------------------
	// 题目引用：`题目id`
	// -----------------------------------------------------------------------

	/**
	 * 把内联代码 `` `题目id` `` 换成可作答的题卡。
	 *
	 * 只处理整段内联代码——围栏代码块、标题里的代码与普通行内代码都保持原样。
	 * 笔记里的 `![[...]]` 原生嵌入完全不受影响：插件不再接管任何 embed。
	 */
	private renderReferences(
		el: HTMLElement,
		post: MarkdownPostProcessorContext
	): Promise<void> | void {
		const codes = Array.from(el.querySelectorAll<HTMLElement>("code")).filter(
			(code) => code.closest("pre") === null && code.closest("h1, h2, h3, h4, h5, h6") === null
		);
		if (codes.length === 0) return;

		const jobs: Promise<void>[] = [];
		for (const code of codes) {
			// 题卡内部不再套题卡，否则题面里引用自己会无限递归。
			if (isInsideQuizCard(code)) continue;
			const id = parseReferenceId(code.textContent ?? "");
			if (id === null) continue;
			jobs.push(this.fillReferencedQuestion(code, id, post));
		}
		if (jobs.length === 0) return;
		// 返回 Promise 会被 Obsidian 收进渲染的 promises 里等待，题卡因此不会晚于整页出现。
		return Promise.all(jobs).then(() => undefined);
	}

	/**
	 * 把内联代码 `` `题目id` `` 换成题卡。
	 *
	 * 引用是异步解析的：找不到、或有重名无法确定是哪一道时，**不改动 DOM**，
	 * 内联代码保持原样，普通代码片段因此不会被打扰。
	 */
	private async fillReferencedQuestion(
		code: HTMLElement,
		id: string,
		post: MarkdownPostProcessorContext
	): Promise<void> {
		const target = await this.findReference(id, post.sourcePath);
		if (target === null) return;
		const file = this.service.fileAtPath(target.path);
		if (file === null) return;

		let question: QuizQuestion | undefined;
		try {
			const parsed = await this.service.parseFile(file);
			question = parsed.questions.find((item) => item.id === id && item.ok);
		} catch {
			question = undefined;
		}
		if (question === undefined) return;

		const parent = code.parentElement;
		if (parent === null) return;
		const host = parent.createDiv({ cls: "easy-quiz-reference" });
		code.replaceWith(host);

		await renderQuizCard(question, {
			app: this.app,
			service: this.service,
			file,
			el: host,
			blockLine: question.blockLine ?? undefined,
			blankMarker: this.settings.blankMarker,
			showStaleHint: this.settings.showStaleHint,
			writeBackEnabled: this.settings.writeBackEnabled,
			onDismissStaleHint: () => this.dismissStaleHint(),
			onOpenSource: () => void openQuestionSource(this.app, file, question),
			addRenderChild: (child) => post.addChild(child),
			onSubmitted: (result) => this.refreshNotice(result.written),
		});
	}

	/** 查一处引用：优先当前笔记，其次整个 vault 里唯一的那一道。 */
	private async findReference(id: string, sourcePath: string): Promise<QuestionReferenceTarget | null> {
		const index = await this.referenceTargets();
		const hits = index.get(id);
		if (hits === undefined) return null;
		return pickReference(hits, sourcePath);
	}

	/**
	 * 建立 id → 题目的索引；一次渲染期间复用，题库变动或设置变更时清空。
	 *
	 * 同一页里常有多处引用，它们会并行调用这里：缓存正在构建时复用同一个
	 * Promise，避免为每个引用各扫一遍整库。
	 */
	private async referenceTargets(): Promise<Map<string, QuestionReferenceTarget[]>> {
		const cached = this.referenceIndex;
		if (cached !== null) return cached;
		const running = this.referenceIndexTask;
		if (running !== null) return running;

		const generation = this.referenceGeneration;
		const task = (async (): Promise<Map<string, QuestionReferenceTarget[]>> => {
			const banks: ReferenceBank[] = [];
			for (const file of this.service.listQuizFiles()) {
				try {
					const parsed = await this.service.parseFile(file);
					banks.push({ path: file.path, questions: parsed.questions });
				} catch {
					continue;
				}
			}
			const index = buildReferenceIndex(banks);
			// 构建期间设置/文件又变了：旧结果不再可信，也不能写回缓存。
			if (generation === this.referenceGeneration) this.referenceIndex = index;
			return index;
		})();
		this.referenceIndexTask = task;
		const clear = (): void => {
			if (this.referenceIndexTask === task) this.referenceIndexTask = null;
		};
		void task.then(clear, clear);
		return task;
	}

	/** 让引用索引失效；下一次引用渲染会重建。 */
	private invalidateReferences(): void {
		this.referenceGeneration += 1;
		this.referenceIndex = null;
		this.referenceIndexTask = null;
	}

	/**
	 * 按设置与 Obsidian 的语言确定界面语言。
	 *
	 * 文案是渲染时取的，因此语言一变就地重画刷题窗口就够了；阅读视图里的题卡是
	 * Obsidian 渲染的，需要显式重画，由 `refreshNotes` 控制。命令名与丝带提示要
	 * 重新加载插件才会更新——Obsidian 没有提供改名命令的 API。
	 *
	 * @param refreshNotes 是否连笔记里已经渲染出来的题卡一起重画。插件加载时不需要
	 *   （那时数据块处理器还没注册，没有题卡可重画），用户改设置时需要。
	 */
	applyLanguage(refreshNotes = false): void {
		if (!setLanguage(resolveLanguage(this.settings.language, languageSources()))) return;
		const views = this.practiceViews();
		for (const view of views) {
			// 只换文案，不动解析结果：列表可以直接复用缓存，避免切语言时整库重扫。
			void view.render();
		}
		// 侧边栏标签页的标题由 Obsidian 缓存，`getDisplayText()` 换了语言它不会自己重画；
		// 触发一次布局变更请它刷新标题（只是重画标签头，不会重建视图，进行中的一轮不会丢）。
		if (views.length > 0) this.app.workspace.trigger("layout-change");
		if (!refreshNotes) return;
		this.refreshNotes();
	}

	/**
	 * 关闭「题面已变更」提示：题卡上的「关闭提示」直接关掉设置里的总开关。
	 *
	 * 与设置页的开关走同一条保存路径，保存后立即重画已渲染的题卡，
	 * 因此提示和右上角统计的警告色会一起消失。
	 */
	async dismissStaleHint(): Promise<void> {
		if (!this.settings.showStaleHint) return;
		this.settings.showStaleHint = false;
		await this.saveSettings();
		this.refreshNotes();
	}

	/** 重画已经渲染出来的题卡：设置改动后让新开关立即生效，不必等下一次渲染。 */
	refreshNotes(): void {
		for (const view of this.practiceViews()) void view.render();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView) rerenderPreviewPreservingScroll(leaf.view);
		}
	}

	private async validateFile(file: TFile): Promise<void> {
		const parsed = await this.service.parseFile(file);
		if (!parsed.fileIsQuiz) {
			new Notice(t("notice.notQuizFile", { name: file.basename }));
			return;
		}
		const ok = parsed.questions.filter((question) => question.ok).length;
		const bad = parsed.questions.length - ok;
		const fileWarnings = parsed.warnings.filter((warning) => warning.questionIndex === null).length;
		const message =
			fileWarnings > 0
				? t("notice.validationFileWarnings", {
						total: parsed.questions.length,
						ok,
						bad,
						count: fileWarnings,
					})
				: t("notice.validation", { total: parsed.questions.length, ok, bad });
		new Notice(message, 6000);
	}

	async loadSettings() {
		const stored = (await this.loadData()) as StoredData | null;
		const { whatsNewSeen, ...raw } = stored ?? {};
		// data.json 可能被手工改坏：所有字段都在这里收敛回合法值，
		// 避免坏类型一路走到 `isQuizFile` 或解析器里抛异常。
		this.settings = sanitizeSettings(raw);
		this.whatsNewSeen = typeof whatsNewSeen === "string" ? whatsNewSeen : null;
		this.lastParseSignature = parseSettingsSignature(this.settings);
	}

	async saveSettings() {
		this.settings = sanitizeSettings(this.settings);
		await this.saveData({ ...this.settings, whatsNewSeen: this.whatsNewSeen });
		this.service?.updateSettings(this.settings);
		// 题的解析方式可能随设置改变（标题层级、空位标记、路径通配符），
		// 已建的引用索引与缓存都不再可信。
		this.invalidateReferences();
		const signature = parseSettingsSignature(this.settings);
		if (signature === this.lastParseSignature) return;
		this.lastParseSignature = signature;
		for (const view of this.practiceViews()) view.markStale();
		this.refreshNotes();
	}
}

/** 非题库文件中的数据块原样显示，避免把普通代码块吃掉。 */
function renderPlainBlock(source: string, el: HTMLElement): void {
	const pre = el.createEl("pre");
	pre.createEl("code", { text: source });
}
