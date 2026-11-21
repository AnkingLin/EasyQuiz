/**
 * 插件设置页。
 *
 * 从 `main.ts` 拆出来，让主入口只保留生命周期与注册逻辑；`SettingsHost`
 * 用接口描述设置页真正需要的几项能力，避免与插件类形成循环依赖。
 */

import { App, Plugin, PluginSettingTab, Setting } from "obsidian";
import { LanguagePreference, t } from "./i18n";
import { DEFAULT_SETTINGS } from "./settings";
import type { RuntimeSettings } from "./settings";
import { BlankMarkerMode } from "./types";

/** 设置页需要的插件能力。 */
export interface SettingsHost {
	settings: RuntimeSettings;
	saveSettings(): Promise<void>;
	applyLanguage(refreshNotes?: boolean): void;
	refreshNotes(): void;
}

export class EasyQuizSettingTab extends PluginSettingTab {
	private host: SettingsHost;

	constructor(app: App, plugin: SettingsHost & Plugin) {
		super(app, plugin);
		// 只保留设置页真正需要的几项能力：把整个 Plugin 存成字段会让
		// `plugin.settings` 被 ESLint 误认为 Obsidian 1.13 才有的 Plugin.settings。
		this.host = plugin;
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
					.setValue(this.host.settings.language)
					.onChange(async (value) => {
						this.host.settings.language = value as LanguagePreference;
						await this.host.saveSettings();
						// 用户在改设置：笔记里已经渲染的题卡也要跟着换语言。
						this.host.applyLanguage(true);
						// 当前语言变了：设置页自己也要按新语言重画。
						this.renderSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setting.blockLanguage.name"))
			.setDesc(t("setting.blockLanguage.desc"))
			.addText((text) =>
				text.setValue(this.host.settings.blockLanguage).onChange(async (value) => {
					this.host.settings.blockLanguage = value.trim() || DEFAULT_SETTINGS.blockLanguage;
					await this.host.saveSettings();
				})
			);

		// 固定层级模式才有「几级标题」可言：自动模式按最近的带数据块标题识别，
		// 这一项不再参与解析，留着只会让人以为它还在生效。
		const headingLevelSetting = new Setting(containerEl)
			.setName(t("setting.headingLevel.name"))
			.setDesc(t("setting.headingLevel.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						"2": t("setting.headingLevel.h2"),
						"3": "H3",
						"4": "H4",
					})
					.setValue(String(this.host.settings.headingLevels[0]))
					.onChange(async (value) => {
						const level = Number(value);
						this.host.settings.headingLevels = [level, level];
						await this.host.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setting.headingMode.name"))
			.setDesc(t("setting.headingMode.desc"))
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						level: t("setting.headingMode.level"),
						auto: t("setting.headingMode.auto"),
					})
					.setValue(this.host.settings.headingMode)
					.onChange(async (value) => {
						this.host.settings.headingMode = value === "auto" ? "auto" : "level";
						await this.host.saveSettings();
						syncHeadingLevel();
					})
			);

		const syncHeadingLevel = (): void => {
			headingLevelSetting.settingEl.style.display =
				this.host.settings.headingMode === "auto" ? "none" : "";
		};
		syncHeadingLevel();

		new Setting(containerEl)
			.setName(t("setting.pathGlobs.name"))
			.setDesc(t("setting.pathGlobs.desc"))
			.addTextArea((area) =>
				area
					.setValue(this.host.settings.pathGlobs.join("\n"))
					.onChange(async (value) => {
						this.host.settings.pathGlobs = value
							.split("\n")
							.map((line) => line.trim())
							.filter((line) => line !== "");
						await this.host.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setting.writeBack.name"))
			.setDesc(t("setting.writeBack.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.writeBackEnabled).onChange(async (value) => {
					this.host.settings.writeBackEnabled = value;
					await this.host.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName(t("setting.staleHint.name"))
			.setDesc(t("setting.staleHint.desc"))
			.addToggle((toggle) =>
				toggle.setValue(this.host.settings.showStaleHint).onChange(async (value) => {
					this.host.settings.showStaleHint = value;
					await this.host.saveSettings();
					this.host.refreshNotes();
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
					.setValue(this.host.settings.blankMarker)
					.onChange(async (value) => {
						this.host.settings.blankMarker = value as BlankMarkerMode;
						await this.host.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName(t("setting.historyLimit.name"))
			.setDesc(t("setting.historyLimit.desc"))
			.addText((text) =>
				text.setValue(String(this.host.settings.historyLimit)).onChange(async (value) => {
					const limit = Number.parseInt(value, 10);
					if (!Number.isNaN(limit) && limit >= 0) {
						this.host.settings.historyLimit = limit;
						await this.host.saveSettings();
					}
				})
			);
	}
}
