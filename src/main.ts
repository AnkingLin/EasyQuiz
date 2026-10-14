import {
	App,
	debounce,
	Editor,
	MarkdownFileInfo,
	MarkdownPostProcessorContext,
	MarkdownView,
	Menu,
	moment,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
} from "obsidian";
import { BlankMarkerMode, ParsedQuizFile, QuizQuestion } from "./types";
import { DEFAULT_SETTINGS, QuizService, RuntimeSettings } from "./runtime";
import { LanguagePreference, LANGUAGE_PREFERENCES, setLanguage, resolveLanguage, t } from "./i18n";
import { renderQuizCard } from "./view";
import { insertQuestionAtCursor, InsertQuestionOptions } from "./insert-modal";
import { registerFileMenu } from "./file-menu";
import { PRACTICE_VIEW_TYPE, PracticeView } from "./practice-view";

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

export default class EasyQuizPlugin extends Plugin {
	// 两者都在 onload 中先于任何注册动作完成初始化。
	settings!: RuntimeSettings;
	service!: QuizService;

	async onload() {
		await this.loadSettings();
		// 语言要先定下来：下面的命令名、丝带提示、设置页文案都要用当前语言。
		this.applyLanguage();
		this.service = new QuizService(this.app, this.settings);

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
				void this.openPracticeView();
			},
		});

		this.addRibbonIcon("graduation-cap", t("command.openPractice"), () => {
			void this.openPracticeView();
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

	onunload() {}

	/**
	 * 打开（或聚焦）刷题窗口。
	 *
	 * Obsidian 没有"单例视图"的开关：先找已经打开的同类型叶子复用，
	 * 没有才在右侧新建一个，避免命令连点开出好几个窗口。
	 * 这里刻意不调用 `revealLeaf`（Obsidian 1.7.2 起才有），
	 * 以保持 manifest 里声明的最低版本；`active: true` 已能让叶子显示出来。
	 */
	private async openPracticeView(): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(PRACTICE_VIEW_TYPE);
		const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
		if (leaf === null) return;
		await leaf.setViewState({ type: PRACTICE_VIEW_TYPE, active: true });
		const view = leaf.view;
		if (view instanceof PracticeView) await view.activate();
	}

	/**
	 * 打开刷题窗口并直接进入某个题库的刷题设置页（文件菜单的入口）。
	 *
	 * 复用 `openPracticeView` 的"单例窗口"逻辑：已经有窗口就地切换页面，
	 * 没有才新建一个，避免从文件菜单点几下就开出好几个窗口。
	 */
	async openPracticeFor(path: string): Promise<void> {
		const existing = this.app.workspace.getLeavesOfType(PRACTICE_VIEW_TYPE);
		const leaf = existing[0] ?? this.app.workspace.getRightLeaf(false);
		if (leaf === null) return;
		await leaf.setViewState({ type: PRACTICE_VIEW_TYPE, active: true });
		const view = leaf.view;
		if (view instanceof PracticeView) await view.openPickerFor(path);
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
		for (const view of this.practiceViews()) view.markStale();
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) continue;
			if (view.file?.path !== file.path) continue;
			if (!force && view.getMode() !== "preview") continue;
			view.previewMode.rerender(true);
		}
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
			// MarkdownRenderer 需要一个 Component 承载生命周期；交给渲染上下文托管。
			addRenderChild: (child) => post.addChild(child),
			onSubmitted: () => this.refreshNotice(),
		});
	}

	private refreshNotice(): void {
		new Notice(t("notice.recorded"));
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
			view.markStale();
			void view.render();
		}
		// 侧边栏标签页的标题由 Obsidian 缓存，`getDisplayText()` 换了语言它不会自己重画；
		// 触发一次布局变更请它刷新标题（只是重画标签头，不会重建视图，进行中的一轮不会丢）。
		if (views.length > 0) this.app.workspace.trigger("layout-change");
		if (!refreshNotes) return;
		for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
			if (leaf.view instanceof MarkdownView) leaf.view.previewMode.rerender(true);
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
		const stored = (await this.loadData()) as Partial<RuntimeSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
		// data.json 可能被手工改坏：语言只认这三种取值，其余一律回到「跟随 Obsidian」，
		// 否则设置页的下拉框会显示成空值。
		if (!LANGUAGE_PREFERENCES.includes(this.settings.language)) {
			this.settings.language = DEFAULT_SETTINGS.language;
		}
	}

	async saveSettings() {
		await this.saveData(this.settings);
		this.service?.updateSettings(this.settings);
	}
}

/** 把数据块对应到题目：优先用行号区间，其次用源码内容比对。 */
export function findQuestion(
	parsed: ParsedQuizFile,
	section: { lineStart: number; lineEnd: number } | null,
	source: string
): QuizQuestion | null {
	if (section) {
		const inside = parsed.questions.filter(
			(question) =>
				question.blockLine !== null &&
				question.blockLine >= section.lineStart &&
				question.blockLine <= section.lineEnd
		);
		const first = inside[0];
		if (first !== undefined) return first;
	}
	const normalized = source.trim();
	const bySource = parsed.questions.filter(
		(question) => question.blockSource !== null && question.blockSource.trim() === normalized
	);
	return bySource[0] ?? null;
}

/** 非题库文件中的数据块原样显示，避免把普通代码块吃掉。 */
function renderPlainBlock(source: string, el: HTMLElement): void {
	const pre = el.createEl("pre");
	pre.createEl("code", { text: source });
}

class EasyQuizSettingTab extends PluginSettingTab {
	plugin: EasyQuizPlugin;

	constructor(app: App, plugin: EasyQuizPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.renderSettings();
	}

	/**
	 * 画出全部设置项。
	 *
	 * 单独抽出来是因为语言切换后要就地重画这一页，而 `display` 在 Obsidian 1.13+
	 * 已被标记为 deprecated（新 API 是声明式的 `getSettingDefinitions`），
	 * 插件要兼容 1.4，因此只重画自己这一层、不去第二次调用它。
	 */
	private renderSettings(): void {
		const { containerEl } = this;
		containerEl.empty();

		// 语言放在最前面：这一页其余文案就是按它渲染的。
		new Setting(containerEl)
			.setName(t("setting.language.name"))
			.setDesc(t("setting.language.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						auto: t("setting.language.auto"),
						// 语言名用各自的母语写法，方便对照识别。
						en: "English",
						zh: "中文",
					})
					.setValue(this.plugin.settings.language)
					.onChange(async (value) => {
						this.plugin.settings.language = value as LanguagePreference;
						await this.plugin.saveSettings();
						// 用户在改设置：笔记里已经渲染的题卡也要跟着换语言。
						this.plugin.applyLanguage(true);
						// 当前语言变了：设置页自己也要按新语言重画。
						this.renderSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setting.blockLanguage.name"))
			.setDesc(t("setting.blockLanguage.desc"))
			.addText((text) =>
				text.setValue(this.plugin.settings.blockLanguage).onChange(async (value) => {
					this.plugin.settings.blockLanguage = value.trim() || DEFAULT_SETTINGS.blockLanguage;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setting.headingLevel.name"))
			.setDesc(t("setting.headingLevel.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"2": t("setting.headingLevel.h2"),
						"3": "H3",
						"4": "H4",
					})
					.setValue(String(this.plugin.settings.headingLevels[0]))
					.onChange(async (value) => {
						const level = Number(value);
						this.plugin.settings.headingLevels = [level, level];
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setting.pathGlobs.name"))
			.setDesc(t("setting.pathGlobs.desc"))
			.addTextArea((area) =>
				area
					.setValue(this.plugin.settings.pathGlobs.join("\n"))
					.onChange(async (value) => {
						this.plugin.settings.pathGlobs = value
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line !== "");
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setting.writeBack.name"))
			.setDesc(t("setting.writeBack.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.writeBackEnabled).onChange(async (value) => {
					this.plugin.settings.writeBackEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setting.blankMarker.name"))
			.setDesc(t("setting.blankMarker.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						highlight: t("setting.blankMarker.highlight"),
						bold: t("setting.blankMarker.bold"),
						both: t("setting.blankMarker.both"),
					})
					.setValue(this.plugin.settings.blankMarker)
					.onChange(async (value) => {
						this.plugin.settings.blankMarker = value as BlankMarkerMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setting.historyLimit.name"))
			.setDesc(t("setting.historyLimit.desc"))
			.addText((text) =>
				text.setValue(String(this.plugin.settings.historyLimit)).onChange(async (value) => {
					const limit = Number.parseInt(value, 10);
					if (!Number.isNaN(limit) && limit >= 0) {
						this.plugin.settings.historyLimit = limit;
						await this.plugin.saveSettings();
					}
				})
			);
	}
}
