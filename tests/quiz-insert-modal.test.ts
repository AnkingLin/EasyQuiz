/**
 * 「插入题目」对话框与插入落点的测试。
 *
 * 与 tests/quiz-match-dom.test.ts 同一思路：在 jsdom 里打开真实的对话框类
 * （obsidian 的 Modal / Setting 由 tests/obsidian-stub.ts 顶替），
 * 触发控件回调后断言预览与最终插入的文本，而不是只测纯函数。
 */

import { setupDom } from "./dom";
import { Editor } from "obsidian";
import { InsertQuestionModal, InsertQuestionOptions, applyInsertion } from "../src/insert-modal";
import { assert, assertEqual, must, test } from "./harness";
import { ButtonComponent } from "./obsidian-stub";

setupDom();

/** 对话框里的一行设置；用 Setting 在元素上的反向引用取回控件。 */
interface SettingLike {
	components: StubComponent[];
}

interface StubComponent {
	value?: string;
	setValue?(value: string): unknown;
	setUserValue?(value: string): void;
	getOptions?(): string[];
}

function settingsOf(modal: InsertQuestionModal): SettingLike[] {
	return Array.from(modal.contentEl.querySelectorAll("div"))
		.map((el) => (el as unknown as { setting?: SettingLike }).setting)
		.filter((setting): setting is SettingLike => setting !== undefined);
}

function componentAt(modal: InsertQuestionModal, index: number): StubComponent {
	const setting = must(settingsOf(modal)[index], `缺少第 ${index} 行设置`);
	return must(setting.components[0], `第 ${index} 行设置没有注册控件`);
}

function openModal(options: Partial<InsertQuestionOptions> = {}) {
	const inserted: string[] = [];
	const modal = new InsertQuestionModal({} as never, {
		headingLevel: 2,
		blockLanguage: "quiz",
		blankMarker: "highlight",
		...options,
		onSubmit: (template) => inserted.push(template),
	});
	modal.open();
	return { modal, inserted };
}

function preview(modal: InsertQuestionModal): string {
	return modal.contentEl.querySelector("pre")?.textContent ?? "";
}

/** 对话框是否还开着：`isOpen` 是测试替身 Modal 提供的，真实 Obsidian 没有这个字段。 */
function isOpen(modal: InsertQuestionModal): boolean {
	return (modal as unknown as { isOpen: boolean }).isOpen;
}

/** 取某一行设置上的按钮替身。 */
function buttonAt(modal: InsertQuestionModal, index: number): ButtonComponent {
	const setting = must(settingsOf(modal)[index], `缺少第 ${index} 行设置`);
	const button = setting.components.find((component) => component instanceof ButtonComponent);
	return must(button, `第 ${index} 行设置没有注册按钮`);
}

// ---------------------------------------------------------------------------
// 对话框
// ---------------------------------------------------------------------------

test("打开对话框时预填默认题型与标题，并给出预览", () => {
	const { modal } = openModal();
	assert(modal.titleEl.textContent !== "", "对话框应有标题");
	assert(preview(modal).startsWith("## 单选题干"), "预览应使用默认标题");
	assert(preview(modal).includes("type: single"), "预览应包含单选数据块");
	assert(preview(modal).includes("- 选项内容 ^a"), "预览应包含带锚点的占位选项");
});

test("题型下拉框列出全部五种题型", () => {
	const { modal } = openModal();
	const dropdown = componentAt(modal, 0);
	const options = must(dropdown.getOptions?.(), "下拉框应提供选项");
	assertEqual(options.join(","), "single,multi,match,blank,essay", "题型顺序应与 QUIZ_TYPES 一致");
});

test("切换题型会同步默认标题与预览", () => {
	const { modal } = openModal();
	componentAt(modal, 0).setUserValue?.("match");
	assert(preview(modal).includes("type: match"), "预览应切换为配对数据块");
	assert(preview(modal).startsWith("## 配对题干"), "标题应跟随题型更新");
	assertEqual(componentAt(modal, 1).value, "配对题干", "输入框里的标题也应更新");
});

test("改过标题后再切换题型不会覆盖用户输入", () => {
	const { modal } = openModal();
	componentAt(modal, 1).setUserValue?.("我自己写的题干");
	componentAt(modal, 0).setUserValue?.("blank");
	assert(preview(modal).startsWith("## 我自己写的题干"), "用户输入的标题应被保留");
	assert(preview(modal).includes("type: blank"), "题型仍应切换");
});

test("填空题预览跟随填空标记设置", () => {
	const bold = openModal({ blankMarker: "bold" });
	componentAt(bold.modal, 0).setUserValue?.("blank");
	assert(preview(bold.modal).includes("**答案**"), "加粗模式应写出加粗标记");

	const highlight = openModal({ blankMarker: "highlight" });
	componentAt(highlight.modal, 0).setUserValue?.("blank");
	assert(preview(highlight.modal).includes("==答案=="), "高亮模式应写出高亮标记");
});

test("点击插入后回调收到预览里的模板并关闭对话框", () => {
	const { modal, inserted } = openModal();
	const shown = preview(modal);
	const button = buttonAt(modal, settingsOf(modal).length - 1);
	button.click();
	assertEqual(inserted.length, 1, "应只提交一次");
	assertEqual(inserted[0], shown, "提交内容应与预览一致");
	assertEqual(isOpen(modal), false, "提交后对话框应关闭");
});

// ---------------------------------------------------------------------------
// 插入落点
// ---------------------------------------------------------------------------

/** 一个字符串即可满足插入所需的最小编辑器接口。 */
function fakeEditor(doc: string, line: number, ch: number): Editor {
	let text = doc;
	let cursor = { line, ch };

	/** 行号/列号 → 全文偏移。行号等于行数时表示文件末尾。 */
	const toOffset = (pos: { line: number; ch: number }) =>
		text.split("\n").slice(0, pos.line).reduce((sum, l) => sum + l.length + 1, 0) + pos.ch;

	const editor = {
		getValue: () => text,
		getLine: (n: number) => text.split("\n")[n] ?? "",
		lastLine: () => text.split("\n").length - 1,
		getCursor: () => ({ ...cursor }),
		getRange: (from: { line: number; ch: number }, to: { line: number; ch: number }) =>
			text.slice(toOffset(from), toOffset(to)),
		replaceRange: (insert: string, from: { line: number; ch: number }, to?: { line: number; ch: number }) => {
			const end = to === undefined ? from : to;
			text = text.slice(0, toOffset(from)) + insert + text.slice(toOffset(end));
		},
		posToOffset: toOffset,
		offsetToPos: (offset: number) => {
			const lines = text.split("\n");
			let remaining = offset;
			for (let i = 0; i < lines.length; i++) {
				const length = must(lines[i], `第 ${i} 行`).length + 1;
				if (remaining < length) return { line: i, ch: remaining };
				remaining -= length;
			}
			return { line: lines.length - 1, ch: must(lines.at(-1), "末行").length };
		},
		setCursor: (pos: { line: number; ch: number }) => {
			cursor = { ...pos };
		},
	};
	return editor as unknown as Editor;
}

function insertAt(doc: string, line: number, ch: number, template: string) {
	const editor = fakeEditor(doc, line, ch);
	const cursor = editor.getCursor();
	applyInsertion(editor, template, {
		cursorLine: cursor.line,
		cursorCh: cursor.ch,
		lineText: (n) => editor.getLine(n),
		textBeforeCursor: () => editor.getRange({ line: cursor.line, ch: 0 }, cursor),
		lastLine: editor.lastLine(),
	});
	return editor;
}

const newQuestion = "## 新题目";

test("空行处插入：正好一个空行分隔，光标停在标题末尾", () => {
	const editor = insertAt("第一段\n\n第二段", 1, 0, newQuestion);
	assertEqual(editor.getValue(), `第一段\n\n${newQuestion}\n\n第二段`, "空行处插入应保持一个空行分隔");
	assertEqual(editor.getCursor().line, 2, "光标应停在插入的标题行");
	assertEqual(editor.getCursor().ch, newQuestion.length, "光标应停在标题末尾");
});

test("上一段行尾插入：另起一段，且只有一个空行", () => {
	const editor = insertAt("第一段\n\n第二段", 0, 3, newQuestion);
	assertEqual(editor.getValue(), `第一段\n\n${newQuestion}\n\n第二段`, "段末插入应正好另起一段");
});

test("光标在正文行首时插入：题目被插到该行之前", () => {
	const editor = insertAt("已有正文\n后续", 0, 0, newQuestion);
	assertEqual(editor.getValue(), `${newQuestion}\n\n已有正文\n后续`, "应把题目插到该行之前并留出空行");
});

test("光标在行尾时有后续内容：另起一段再插入", () => {
	const editor = insertAt("已有正文\n后续", 0, 4, newQuestion);
	assertEqual(editor.getValue(), `已有正文\n\n${newQuestion}\n\n后续`, "应在正文后另起一段");
	assertEqual(editor.getCursor().line, 2, "光标应落在插入的标题行");
	assertEqual(editor.getCursor().ch, newQuestion.length, "光标应停在标题末尾");
});

test("文末插入：不产生多余的尾随空行", () => {
	const editor = insertAt("已有正文", 0, 4, newQuestion);
	assertEqual(editor.getValue(), `已有正文\n\n${newQuestion}`, "文末插入不应补尾随换行");
});

test("行中插入：把该行切成两段", () => {
	const editor = insertAt("前半后半", 0, 2, newQuestion);
	assertEqual(editor.getValue(), `前半\n\n${newQuestion}\n\n后半`, "行中插入应把模板独立成段");
});

test("连续插入两道题：空行数量不累积", () => {
	const first = insertAt("第一段\n\n第二段", 1, 0, newQuestion);
	const again = insertAt(first.getValue(), 3, 0, "## 第二道题");
	assertEqual(
		again.getValue(),
		`第一段\n\n${newQuestion}\n\n## 第二道题\n\n第二段`,
		"每题之间只应有一个空行"
	);
});

test("光标停在题干标题末尾，方便直接改标题", () => {
	const template = "## 单选题干\n\n- 选项内容 ^a\n\n```quiz\ntype: single\n```";
	const editor = insertAt("", 0, 0, template);
	assertEqual(editor.getCursor().line, 0, "光标应在第一行");
	assertEqual(editor.getCursor().ch, "## 单选题干".length, "光标应停在题干标题末尾");
});
