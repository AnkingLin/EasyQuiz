import { App, debounce, MarkdownView, Notice, Plugin, PluginSettingTab, Setting, TFile } from "obsidian";
import { BlankMarkerMode, ParsedQuizFile, QuizQuestion } from "./types";
import { DEFAULT_SETTINGS, QuizService, RuntimeSettings } from "./runtime";
import { renderQuizCard } from "./view";

export default class EasyQuizPlugin extends Plugin {
	// 两者都在 onload 中先于任何注册动作完成初始化。
	settings!: RuntimeSettings;
	service!: QuizService;

	async onload() {
		await this.loadSettings();
		this.service = new QuizService(this.app, this.settings);

		// 题库文件中的数据块由这里渲染成刷题界面。
		// 阅读视图/预览中渲染；实时预览下光标进入会还原为源码，属 Obsidian 的既定行为。
		this.registerMarkdownCodeBlockProcessor(
			this.settings.blockLanguage,
			async (source, el, ctx) => {
				await this.renderBlock(source, el, ctx.sourcePath, ctx.getSectionInfo(el));
			}
		);

		// 题目被编辑后，阅读视图里的数据块不会自动重渲染，需要手动刷新一次。
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
			name: "刷新题库视图",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) this.refreshPreviews(file, true);
				return true;
			},
		});

		this.addCommand({
			id: "validate-quiz-file",
			name: "校验当前题库文件",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (!file || file.extension !== "md") return false;
				if (!checking) void this.validateFile(file);
				return true;
			},
		});

		this.addSettingTab(new EasyQuizSettingTab(this.app, this));
	}

	onunload() {}

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
		sourcePath: string,
		section: { lineStart: number; lineEnd: number } | null
	): Promise<void> {
		el.empty();
		el.addClass("easy-quiz-block");

		const file = this.app.vault.getAbstractFileByPath(sourcePath);
		if (!(file instanceof TFile)) {
			el.createDiv({ cls: "easy-quiz-card is-diagnostic", text: "找不到文件，无法渲染题目。" });
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
				text: `解析失败：${error instanceof Error ? error.message : String(error)}`,
			});
			return;
		}

		const question = findQuestion(parsed, section, source);
		if (!question) {
			el.createDiv({
				cls: "easy-quiz-card is-diagnostic",
				text: "这个数据块不属于任何题面标题，无法渲染为题目。请把它放到某个标题之下。",
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
			onSubmitted: () => this.refreshNotice(),
		});
	}

	private refreshNotice(): void {
		new Notice("已记录本次作答。");
	}

	private async validateFile(file: TFile): Promise<void> {
		const parsed = await this.service.parseFile(file);
		if (!parsed.fileIsQuiz) {
			new Notice(`「${file.basename}」不是题库文件（缺少 quiz: true 或 #quiz）。`);
			return;
		}
		const ok = parsed.questions.filter((question) => question.ok).length;
		const bad = parsed.questions.length - ok;
		const fileWarnings = parsed.warnings.filter((warning) => warning.questionIndex === null).length;
		new Notice(
			`共 ${parsed.questions.length} 道题：可作答 ${ok}，需修正 ${bad}${fileWarnings > 0 ? `，文件级提示 ${fileWarnings} 条` : ""}。`,
			6000
		);
	}

	async loadSettings() {
		const stored = (await this.loadData()) as Partial<RuntimeSettings> | null;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored ?? {});
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
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("数据块语言")
			.setDesc("题目数据块使用的围栏语言。改动后需要重新加载 Obsidian。")
			.addText((text) =>
				text.setValue(this.plugin.settings.blockLanguage).onChange(async (value) => {
					this.plugin.settings.blockLanguage = value.trim() || DEFAULT_SETTINGS.blockLanguage;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("题面标题层级")
			.setDesc("决定哪些标题被当作一道题。默认只认二级标题。")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"2": "H2（默认）",
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
			.setName("题库路径通配符")
			.setDesc("每行一条，例如 题库/**。命中的文件也会被当作题库。")
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
			.setName("记录写回")
			.setDesc("关闭后只在界面上判分，不会修改笔记文件。")
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.writeBackEnabled).onChange(async (value) => {
					this.plugin.settings.writeBackEnabled = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName("填空标记")
			.setDesc("填空题用哪种 Markdown 标记挖空。空位锚点 ^b1 可以省略，省略时按出现顺序自动编号。")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						highlight: "== 高亮 ==",
						bold: "** 加粗 **",
						both: "两者都识别",
					})
					.setValue(this.plugin.settings.blankMarker)
					.onChange(async (value) => {
						this.plugin.settings.blankMarker = value as BlankMarkerMode;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName("单题历史条数上限")
			.setDesc("记录写在笔记内，必须有上限；0 表示只保留汇总。")
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
