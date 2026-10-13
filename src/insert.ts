/**
 * 插入题目的模板生成与插入定位（纯逻辑，不依赖 obsidian）。
 *
 * 对话框只负责收集「题型 + 题干标题」，Markdown 骨架与插入位置都在这里算，
 * 因此「模板是否与解析器兼容」「插入后空行数量」都能单测，不需要真的开一个 Obsidian 窗口。
 *
 * 模板刻意保留占位文字（`选项内容 ^a`、`==答案==`）：插入后题目本身就能被识别，
 * 作者只需把占位文字替换成真实内容，不必再回忆字段和语法。
 *
 * 这些占位文字会写进用户的笔记，所以它们跟随界面语言（`src/i18n`）：中文环境插入
 * 中文骨架，英文环境插入英文骨架。语法标记（`==`、`^a`、`> [!question]`）不翻译。
 */

import { t } from "./i18n";
import { defaultTitles } from "./labels";
import { KNOWLEDGE_LINK_AT_END } from "./parser";
import { BlankMarkerMode, QuizType } from "./types";

export interface TemplateOptions {
	type: QuizType;
	/** 题干标题；为空时回退到该题型的默认标题。 */
	title: string;
	/** 题干标题层级，来自设置的题面标题层级。 */
	headingLevel: number;
	/** 数据块语言，来自设置。 */
	blockLanguage: string;
	/** 空位标记样式，来自设置；决定填空题模板写 `==…==` 还是 `**…**`。 */
	blankMarker: BlankMarkerMode;
}

/** 标题层级收敛到合法范围（1–6）。 */
function normalizeLevel(level: number): number {
	if (!Number.isFinite(level)) return 2;
	return Math.min(6, Math.max(1, Math.round(level)));
}

/** 标题里不能有换行，否则会把模板结构撑坏。 */
function normalizeTitle(title: string): string {
	return title.replace(/\s*\n\s*/g, " ").trim();
}

/**
 * 拆出标题正文与末尾的知识点链接。
 *
 * 链接的匹配与写法由解析器统一给出（`^[[[知识点]]]`，旧写法 `^[[知识点]]` 也认），
 * 这里只负责把作者写的那份链接**原样**带回模板——否则从对话框插入的题目会丢掉
 * 溯源信息，或者被改写成另一种写法。
 */
function splitTrailingKnowledgeLink(title: string): { text: string; suffix: string } {
	const match = KNOWLEDGE_LINK_AT_END.exec(title);
	if (!match) return { text: title, suffix: "" };
	const text = title.slice(0, match.index).trimEnd();
	// 正文为空时不补前导空格，避免标题行出现 `##  ^[[[…]]]` 这样的双空格。
	return { text, suffix: `${text === "" ? "" : " "}${match[0].trim()}` };
}

function heading(options: TemplateOptions): string {
	const level = normalizeLevel(options.headingLevel);
	const { text, suffix } = splitTrailingKnowledgeLink(normalizeTitle(options.title));
	// 只有「标题正文 + 知识点链接都没有」时才回退到默认标题：
	// 只写了 `^[[[知识点]]]` 的标题仍是一道有溯源的题，不该被默认标题顶掉。
	const body = text === "" && suffix === "" ? defaultTitles()[options.type] : text;
	return `${"#".repeat(level)} ${body}${suffix}`;
}

/**
 * 生成填空题的挖空标记。
 *
 * `both` 模式写成带锚点的高亮：锚点让作者能在 `blanks` 里引用某个空位，
 * 而高亮是默认标记，改回默认设置后这份模板仍然有效。
 */
function blankMarkerText(mode: BlankMarkerMode): string {
	const marker = mode === "bold" ? t("insert.blank.bold") : t("insert.blank.highlight");
	return `${marker} ^b1`;
}

/** 数据块：空行之后的围栏代码块。 */
function dataBlock(options: TemplateOptions, lines: string[]): string {
	return ["```" + options.blockLanguage, ...lines, "```"].join("\n");
}

/**
 * 生成一段可直接插入笔记的题目 Markdown。
 *
 * 返回文本不含首尾空行；与相邻段落之间的空行由 {@link planInsertion} 负责。
 */
export function buildQuestionTemplate(options: TemplateOptions): string {
	const head = heading(options);
	const optionA = t("insert.option.placeholderA");
	const optionB = t("insert.option.placeholderB");
	switch (options.type) {
		case "single":
			return [
				head,
				"",
				`- ${optionA}`,
				`- ${optionB}`,
				"",
				dataBlock(options, ["type: single", "answer: a"]),
			].join("\n");
		case "multi":
			return [
				head,
				"",
				`- ${optionA}`,
				`- ${optionB}`,
				"",
				dataBlock(options, ["type: multi", "answer: [a, b]"]),
			].join("\n");
		case "match":
			return [
				head,
				"",
				`| ${t("insert.table.headerLeft")} | ${t("insert.table.headerRight")} |`,
				"| --- | --- |",
				`| ${t("insert.table.cellLeft")} | ${t("insert.table.cellRight")} |`,
				"",
				dataBlock(options, ["type: match"]),
			].join("\n");
		case "blank":
			return [
				head,
				"",
				t("insert.blank.stem", { marker: blankMarkerText(options.blankMarker) }),
				"",
				dataBlock(options, ["type: blank"]),
			].join("\n");
		case "essay":
		default:
			return [
				head,
				"",
				t("insert.essay.stem"),
				"",
				`> [!question]- ${t("insert.essay.callout")}`,
				`> ${t("insert.essay.answer")}`,
				"",
				dataBlock(options, ["type: essay"]),
			].join("\n");
	}
}

// ---------------------------------------------------------------------------
// 插入定位
// ---------------------------------------------------------------------------

/** 插入所需的编辑器读数；只读这几项，因此插入定位可以脱离 Obsidian 单测。 */
export interface EditorReadout {
	/** 光标所在行号。 */
	cursorLine: number;
	/** 光标所在列号。 */
	cursorCh: number;
	/** 指定行的文本；行号越界时返回空串（文件末尾之外视为空行）。 */
	lineText: (line: number) => string;
	/** 从某行行首到光标之间的文本。 */
	textBeforeCursor: () => string;
}

export interface InsertionContext {
	/** 界面上要被替换掉的起点。 */
	start: { line: number; ch: number };
	/** 界面上要被替换掉的终点。 */
	end: { line: number; ch: number };
	/** 替换后的文本。 */
	text: string;
	/** 替换后光标相对 `start` 的偏移。 */
	cursorOffset: number;
}

/**
 * 前侧空隙：从光标往前越过连续的空行，停在第一个有内容的位置。
 *
 * 越过空行是必须的——那些空行会被下面的归一化结果取代，留着就会越插越多空行。
 * 光标所在行只要有内容（包括缩进），就以它为界，不再往前吞行。
 */
function scanBackward(readout: EditorReadout): { line: number; text: string } {
	const currentLine = readout.lineText(readout.cursorLine);
	const before = readout.textBeforeCursor();
	if (before.trim() !== "" || currentLine.trim() !== "") {
		return { line: readout.cursorLine, text: before };
	}
	let line = readout.cursorLine;
	while (line > 0) {
		const previous = readout.lineText(line - 1);
		if (previous.trim() !== "") return { line: line - 1, text: previous };
		line--;
	}
	return { line: 0, text: "" };
}

/**
 * 后侧空隙：从光标往后越过连续的空行，停在第一个有内容的位置。
 *
 * 返回的是「有内容的那一行」；`line === lineCount` 表示后面只剩空行或已到文末。
 */
function scanForward(readout: EditorReadout, lineCount: number): { line: number; text: string } {
	const rest = readout.lineText(readout.cursorLine).slice(readout.cursorCh);
	if (rest.trim() !== "") return { line: readout.cursorLine, text: rest };
	let line = readout.cursorLine + 1;
	while (line < lineCount) {
		const text = readout.lineText(line);
		if (text.trim() !== "") return { line, text };
		line++;
	}
	return { line: lineCount, text: "" };
}

/**
 * 归一化插入点两侧的空隙，并给出要替换的区间。
 *
 * 结果固定为「前侧有内容时 `\n\n`，否则为空」，因此无论光标落在段末、空行上、
 * 行中还是文末，插入后题目与相邻段落之间都正好一个空行，也不会越插越多空行。
 * 只有光标上方就是文档开头（前面全是空白行）时，前侧才是真正的「无内容」。
 */
export function planInsertion(template: string, readout: EditorReadout, lineCount: number): InsertionContext {
	const back = scanBackward(readout);
	const forward = scanForward(readout, lineCount);
	// 前侧真的没有内容（光标上方就是从文首开始的空行）时，题目直接顶到文首。
	const nothingBefore = back.text.trim() === "";
	const prefix = nothingBefore ? "" : `${back.text.replace(/[\s\uFEFF]+$/, "")}\n\n`;
	const suffix = forward.text.trim() === "" ? "" : `\n\n${forward.text.replace(/^[\s\uFEFF]+/, "")}`;

	// 替换区间：前侧为空时从光标所在行开始，否则连同前一行一起替换；
	// 后侧为空时替换到文件末尾，否则到后侧那一行的行尾。
	const lastLine = Math.max(0, lineCount - 1);
	const start = nothingBefore
		? { line: Math.min(readout.cursorLine, lastLine), ch: readout.cursorCh }
		: { line: back.line, ch: 0 };
	const end =
		forward.line >= lineCount
			? { line: lastLine, ch: readout.lineText(lastLine).length }
			: { line: forward.line, ch: readout.lineText(forward.line).length };

	// 模板首行是题干标题；光标落在标题末尾，方便作者直接改标题。
	const firstBreak = template.indexOf("\n");
	return {
		start,
		end,
		text: `${prefix}${template}${suffix}`,
		cursorOffset: prefix.length + (firstBreak < 0 ? template.length : firstBreak),
	};
}
