/**
 * 题面预处理（纯逻辑，不依赖 obsidian）。
 *
 * 交互控件负责的题目内容不能同时出现在题面里，否则用户会看到两份：
 *   - 选择题的选项列表由选项控件渲染 → 题面去掉顶层列表；
 *   - 配对题的表格由连线题板渲染 → 题面去掉表格行；
 *   - 填空题的空位由空位输入框渲染 → 题面把标记换成占位标记。
 */

import { BlankMarkerMode, QuizQuestion } from "./types";

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
	let text = question.body;

	if (question.type === "blank") {
		// 按解析出的空位顺序替换，保证占位标记与 blankRules 里的锚点一一对应
		// （解析阶段已排除代码块/行内代码里的标记）。
		let index = 0;
		const nextId = (anchor?: string): string => {
			const parsed = question.blanks[index];
			index++;
			return parsed?.anchor ?? anchor?.replace(/[\s^]/g, "") ?? `b${index}`;
		};
		for (const { regex } of activeMarker(mode)) {
			const pattern = new RegExp(regex.source, "g");
			text = text.replace(pattern, (_match, _answer: string, anchor?: string) => {
				return `\`${BLANK_MARKER_PREFIX}${nextId(anchor)}\``;
			});
		}
	} else {
		// 非填空题：标记只是装饰，保留文字、去掉符号。
		for (const { regex } of activeMarker(mode)) {
			const pattern = new RegExp(regex.source, "g");
			text = text.replace(pattern, "$1");
		}
	}

	// 其余锚点（选项的 `^a`、配对表格里的锚点）不参与题面显示。
	text = text.replace(ANCHOR_AT_END, "");

	if (question.type === "single" || question.type === "multi") {
		text = dropTopLevelLists(text);
	}
	if (question.type === "match") {
		text = dropTables(text);
	}
	return text.replace(/\n{3,}/g, "\n\n").trim();
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
