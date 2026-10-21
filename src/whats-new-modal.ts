/**
 * 更新后的一次性「更新内容」对话框。
 *
 * 只在插件记录的版本与当前版本不同时打开（见 main.ts 的 announceWhatsNew），
 * 因此不需要用户手动关闭之后永远不再提醒的状态。
 */

import { App, Modal, Setting } from "obsidian";
import { t } from "./i18n";
import type { WhatsNewEntry } from "./whats-new";

export class WhatsNewModal extends Modal {
	constructor(
		app: App,
		private readonly entry: WhatsNewEntry
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("easy-quiz-whats-new");
		contentEl.createEl("h2", {
			text: t("whatsNew.title", { version: this.entry.version }),
		});
		contentEl.createEl("p", { text: t("whatsNew.intro") });

		const list = contentEl.createEl("ul");
		for (const key of this.entry.changes) {
			list.createEl("li", { text: t(key) });
		}

		new Setting(contentEl).addButton((button) =>
			button.setButtonText(t("whatsNew.close")).setCta().onClick(() => this.close())
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
