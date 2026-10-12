/**
 * 「插入题目」对话框。
 *
 * 只收集题型与题干标题，Markdown 骨架由 `insert.ts` 拼装，实时预览让人在插入前
 * 就看得到结果。真正的写入由调用方（命令 / 右键菜单）通过 Editor 完成，
 * 对话框本身不碰文件。
 */

import { App, Editor, Modal, Setting, TextComponent } from "obsidian";
import { buildQuestionTemplate, DEFAULT_TITLES, planInsertion, TYPE_LABELS, TemplateOptions } from "./insert";
import { BlankMarkerMode, QUIZ_TYPES, QuizType } from "./types";

export interface InsertQuestionModalOptions {
	/** 题干标题层级，来自设置。 */
	headingLevel: number;
	/** 数据块语言，来自设置。 */
	blockLanguage: string;
	/** 空位标记样式，来自设置。 */
	blankMarker: BlankMarkerMode;
	/** 用户确认后的回调，参数为生成的 Markdown 骨架。 */
	onSubmit: (template: string, type: QuizType) => void;
}

export class InsertQuestionModal extends Modal {
	private type: QuizType = "single";
	private title = DEFAULT_TITLES.single;
	/** 用户是否改过标题：改过之后切换题型不再覆盖，避免把输入冲掉。 */
	private titleEdited = false;
	private titleInput: TextComponent | null = null;
	private previewEl: HTMLElement | null = null;

	constructor(app: App, private options: InsertQuestionModalOptions) {
		super(app);
	}

	onOpen(): void {
		this.titleEl.setText("插入题目");
		const { contentEl } = this;

		new Setting(contentEl)
			.setName("题型")
			.setDesc("决定插入哪种题目的骨架。字段与语法由模板给出，插入后再填内容。")
			.addDropdown((dropdown) => {
				for (const type of QUIZ_TYPES) dropdown.addOption(type, TYPE_LABELS[type]);
				dropdown.setValue(this.type).onChange((value) => {
					this.type = value as QuizType;
					if (!this.titleEdited) {
						this.title = DEFAULT_TITLES[this.type];
						this.titleInput?.setValue(this.title);
					}
					this.refresh();
				});
			});

		new Setting(contentEl)
			.setName("题干标题")
			.setDesc("会自动加上设置里的标题层级（默认二级）。")
			.addText((text) => {
				this.titleInput = text;
				text.setValue(this.title).onChange((value) => {
					this.title = value;
					this.titleEdited = true;
					this.refresh();
				});
			});

		contentEl.createDiv({ cls: "easy-quiz-insert__label", text: "预览" });
		this.previewEl = contentEl.createEl("pre", { cls: "easy-quiz-insert__preview" });

		this.refresh();

		new Setting(contentEl).addButton((button) =>
			button
				.setButtonText("插入")
				.setCta()
				.onClick(() => {
					this.options.onSubmit(this.template(), this.type);
					this.close();
				})
		);
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private template(): string {
		const options: TemplateOptions = {
			type: this.type,
			title: this.title,
			headingLevel: this.options.headingLevel,
			blockLanguage: this.options.blockLanguage,
			blankMarker: this.options.blankMarker,
		};
		return buildQuestionTemplate(options);
	}

	private refresh(): void {
		this.previewEl?.setText(this.template());
	}
}

/** 插入所需的设置项（对话框与插入逻辑共用）。 */
export type InsertQuestionOptions = Omit<InsertQuestionModalOptions, "onSubmit">;

/** 插入所需的编辑器能力。只依赖这几项，因此插入逻辑可以脱离 Obsidian 单测。 */
export interface InsertionTarget {
	/** 光标所在行号。 */
	cursorLine: number;
	/** 光标所在列号。 */
	cursorCh: number;
	/** 指定行的文本；行号越界时返回空串。 */
	lineText: (line: number) => string;
	/** 从某行行首到光标之间的文本。 */
	textBeforeCursor: () => string;
	/** 文件最后一行行号。 */
	lastLine: number;
}

/**
 * 把模板插入编辑器，并把光标放到题干标题末尾。
 *
 * 与对话框解耦：命令、右键菜单以及测试都用这一个函数，插入行为只有一份实现。
 * 插入会连光标周围那些只剩空白的行一起替换掉，因此反复插入不会越积越多空行。
 */
export function applyInsertion(editor: Editor, template: string, target: InsertionTarget): void {
	const insertion = planInsertion(
		template,
		{
			cursorLine: target.cursorLine,
			cursorCh: target.cursorCh,
			lineText: target.lineText,
			textBeforeCursor: target.textBeforeCursor,
		},
		target.lastLine + 1
	);
	editor.replaceRange(insertion.text, insertion.start, insertion.end);
	// 光标落在题干标题末尾，作者可以直接改标题。
	editor.setCursor(editor.offsetToPos(editor.posToOffset(insertion.start) + insertion.cursorOffset));
}

/**
 * 打开「插入题目」对话框；确认后在光标处插入题目骨架。
 *
 * 命令与右键菜单共用这一个入口，避免两处各写一套插入逻辑。
 */
export function insertQuestionAtCursor(
	app: App,
	editor: Editor,
	options: InsertQuestionOptions
): void {
	new InsertQuestionModal(app, {
		...options,
		onSubmit: (template) => {
			const cursor = editor.getCursor();
			applyInsertion(editor, template, {
				cursorLine: cursor.line,
				cursorCh: cursor.ch,
				lineText: (line) => editor.getLine(line) ?? "",
				textBeforeCursor: () => editor.getRange({ line: cursor.line, ch: 0 }, cursor),
				lastLine: editor.lastLine(),
			});
		},
	}).open();
}
