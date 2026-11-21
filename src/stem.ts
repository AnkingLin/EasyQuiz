/**
 * 题面预处理（纯逻辑，不依赖 obsidian）。
 *
 * 交互控件负责的题目内容不能同时出现在题面里，否则用户会看到两份：
 *   - 选择题的选项列表由选项控件渲染 → 题面去掉顶层列表；
 *   - 配对题的表格由连线题板渲染 → 题面去掉表格行；
 *   - 填空题的空位由空位输入框渲染 → 题面把标记换成占位标记。
 */

import { BlankMarkerMode, QuizQuestion } from "./types";
import { codeRanges, findBlankSpans } from "./parser";

/** 填空题题面中的占位标记前缀；渲染后会被替换成可点击的空位输入框。 */
export const BLANK_MARKER_PREFIX = "easyquiz-blank:";

/** 锚点：`^id`，前面必须有空白或行首。 */
const ANCHOR_AT_END = /[ \t]\^[A-Za-z0-9\-_]+(?=\s|$)/gm;
/** 带锚点的高亮：`==答案== ^b1`。 */
const HIGHLIGHT_WITH_ANCHOR = /==([^=]+)==(\s*\^[A-Za-z0-9\-_]+)?/g;
/** 带锚点的加粗：`**答案** ^b1`。 */
const BOLD_WITH_ANCHOR = /\*\*([^*]+)\*\*(\s*\^[A-Za-z0-9\-_]+)?/g;

/** 按配置决定要处理哪些标记；未启用的标记原样保留（例如 `==` 模式下加粗仍是加粗）。 */
function activeMarker(mode: BlankMarkerMode): { regex: RegExp; group: number }[] {
	if (mode === "bold") return [{ regex: BOLD_WITH_ANCHOR, group: 1 }];
	if (mode === "both") {
		return [
			{ regex: HIGHLIGHT_WITH_ANCHOR, group: 1 },
			{ regex: BOLD_WITH_ANCHOR, group: 1 },
		];
	}
	return [{ regex: HIGHLIGHT_WITH_ANCHOR, group: 1 }];
}

/**
 * 生成用于渲染的题面 Markdown。
 *
 * @param mode 空位标记样式；与解析设置保持一致，否则题面与空位会对不上。
 */
export function formatStem(question: QuizQuestion, mode: BlankMarkerMode = "highlight"): string {
	// 解析器已经按"最近的一段"裁好题面；手动构造的对象没有 stemText 时回退到整段正文。
	let text = question.stemText ?? question.body;

	if (question.type === "blank") {
		// 用与解析器相同的扫描结果替换空位：代码示例里的标记不会被误当成空位，
		// 混合两种标记时也不会因为分两轮替换而把锚点顺序弄反。
		const spans = findBlankSpans(text, mode);
		const anchors = question.blanks.map((blank) => blank.anchor);
		for (let index = spans.length - 1; index >= 0; index--) {
			const span = spans[index];
			if (span === undefined) continue;
			const anchor = anchors[index] ?? span.anchor;
			text =
				text.slice(0, span.index) +
				`\`${BLANK_MARKER_PREFIX}${anchor}\`` +
				text.slice(span.index + span.length);
		}
	} else {
		// 非填空题：标记只是装饰，保留文字、去掉符号；代码里的示例保持原样。
		text = stripDecorations(text, mode);
	}

	// 其余锚点（选项的 `^a`、配对表格里的锚点）不参与题面显示；代码里的不动。
	text = stripTrailingAnchors(text);

	if (question.type === "single" || question.type === "multi") {
		// 解析器已经把选项列表从 stemText 里排除；只有手动构造、没有 stemText 的对象
		// 才需要从 body 里再删一次。否则会把题干上方作为材料显示的列表一起删掉。
		if (question.stemText === undefined) text = dropTopLevelLists(text);
	}
	// 配对题的结构表格由题板接管，解析阶段已把它从题面里剔除；题面里剩下的
	// 表格（例如上面作为材料的数据表）属于题目内容，按 Markdown 正常显示。
	return ensureTableSpacing(text).replace(/\n{3,}/g, "\n\n").trim();
}

/** 按当前标记样式去掉装饰符号，但跳过代码块与行内代码。 */
function stripDecorations(text: string, mode: BlankMarkerMode): string {
	for (const { regex } of activeMarker(mode)) {
		text = mapOutsideCode(text, (segment) => segment.replace(new RegExp(regex.source, "g"), "$1"));
	}
	return text;
}

/** 去掉代码区域之外的尾部锚点。 */
function stripTrailingAnchors(text: string): string {
	return mapOutsideCode(text, (segment) => segment.replace(ANCHOR_AT_END, ""));
}

/**
 * 只对代码区域之外的片段做替换。
 *
 * 题面里的代码示例可能写着 `==答案==` 或 `^a`，那是内容而不是标记；直接全局
 * 替换会把示例改坏，甚至把占位符塞进代码块。
 */
function mapOutsideCode(text: string, transform: (segment: string) => string): string {
	const ranges = codeRanges(text);
	if (ranges.length === 0) return transform(text);
	let result = "";
	let cursor = 0;
	for (const [start, end] of ranges) {
		if (end <= cursor) continue;
		if (start > cursor) result += transform(text.slice(cursor, start));
		result += text.slice(Math.max(start, cursor), end);
		cursor = end;
	}
	if (cursor < text.length) result += transform(text.slice(cursor));
	return result;
}

/**
 * 生成补充内容的 Markdown：和题面一样是普通文字，只是去掉了装饰标记与尾部锚点。
 * 没有补充内容时返回空串。
 */
export function formatSupplement(question: QuizQuestion, mode: BlankMarkerMode = "highlight"): string {
	const source = question.supplementText?.trim() ?? "";
	if (source === "") return "";
	let text = stripDecorations(source, mode);
	text = stripTrailingAnchors(text);
	return ensureTableSpacing(text).replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 表格前后必须有空行，否则 Obsidian 不会把它当成独立的表格段落（答题页会显示成
 * 一行行竖线）。代码块内的表格不处理。
 */
export function ensureTableSpacing(text: string): string {
	const lines = text.split("\n");
	const out: string[] = [];
	let fenceMarker: string | null = null;
	let index = 0;
	while (index < lines.length) {
		const line = lines[index] ?? "";
		const fence = /^\s*(`{3,}|~{3,})/.exec(line);
		const markers = fence?.[1];
		if (markers !== undefined && markers !== "") {
			const marker = markers.slice(0, 1);
			if (fenceMarker === null) fenceMarker = marker;
			else if (fenceMarker === marker) fenceMarker = null;
			out.push(line);
			index++;
			continue;
		}
		if (fenceMarker !== null || !line.trim().startsWith("|")) {
			out.push(line);
			index++;
			continue;
		}
		if (out.length > 0 && (out[out.length - 1] ?? "").trim() !== "") out.push("");
		while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
			out.push(lines[index] ?? "");
			index++;
		}
		if (index < lines.length && (lines[index] ?? "").trim() !== "") out.push("");
	}
	return out.join("\n");
}

/** 去掉顶层列表项（选项已由选项控件渲染）。代码块内的内容不动。 */
export function dropTopLevelLists(text: string): string {
	const kept: string[] = [];
	let fenceMarker: string | null = null;

	for (const line of text.split("\n")) {
		const fence = /^\s*(`{3,}|~{3,})/.exec(line);
		const markers = fence?.[1];
		if (markers !== undefined && markers !== "") {
			const marker = markers.slice(0, 1);
			if (fenceMarker === null) fenceMarker = marker;
			else if (fenceMarker === marker) fenceMarker = null;
			kept.push(line);
			continue;
		}
		const isListItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
		if (fenceMarker === null && isListItem) continue;
		kept.push(line);
	}
	return kept.join("\n");
}

/** 去掉表格行（配对表格已由连线题板渲染）。 */
export function dropTables(text: string): string {
	return text
		.split("\n")
		.filter((line) => !line.trim().startsWith("|"))
		.join("\n");
}
