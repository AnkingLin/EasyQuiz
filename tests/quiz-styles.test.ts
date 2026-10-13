/**
 * 样式表里「复盘高亮」的可读性自检。
 *
 * 背景：Obsidian 默认主题把 `--background-modifier-success` 与 `--text-success` 都定义成
 * `var(--color-green)`——**同一个颜色**。所以「用 success 铺底色 + 用 text-success 写字」
 * 写出来的是一块纯色方块，文字完全看不见（填空题的答案方块就是这么丢的）。
 *
 * 这类问题在 jsdom 里测不出来（没有布局与取色），也没法在 node 下算颜色，因此这里退一步，
 * 直接对样式表文本断言：复盘高亮必须是半透明淡染，而不是实心 success 色。
 */

import styles from "../styles.css";
import { assert, test } from "./harness";

/** 取出某个选择器的声明块（本文档里的规则都是平铺的一层，没有嵌套）。 */
function ruleBlock(css: string, selector: string): string {
	const start = css.indexOf(`\n${selector} {`);
	assert(start >= 0, `样式表里找不到规则 ${selector}`);
	const open = css.indexOf("{", start);
	const close = css.indexOf("}", open);
	assert(open > 0 && close > open, `${selector} 的规则块不完整`);
	const block = css.slice(open + 1, close);
	assert(block.includes("background"), `${selector} 应当显式声明 background`);
	return block;
}

/** 所有使用了「实心 success 底色」的地方：这个写法在默认主题下必然导致文字同色。 */
function solidSuccessBackgrounds(css: string): string[] {
	const offenders: string[] = [];
	const pattern = /background:\s*var\(--background-modifier-success[^;]*;/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(css)) !== null) {
		const line = css.slice(0, match.index).split("\n").length;
		offenders.push(`第 ${line} 行：${match[0]}`);
	}
	return offenders;
}

test("样式：没有任何规则用实心的 success 色铺底（会与文字同色）", () => {
	const offenders = solidSuccessBackgrounds(styles);
	assert(
		offenders.length === 0,
		`--background-modifier-success 与 --text-success 是同一个颜色，不能当底色用：\n${offenders.join("\n")}`
	);
});

test("样式：空位答案用半透明绿色淡染，文字保持可读", () => {
	const block = ruleBlock(styles, ".easy-quiz-card__blank-answer");
	assert(
		/background:\s*color-mix\([^;]*transparent\s*\)/.test(block),
		`空位答案的底色应是半透明淡染（color-mix(... transparent)），实际：${block.trim()}`
	);
	assert(/color:\s*var\(--text-success\)/.test(block), "空位答案的文字仍应是绿色，保留正确语义");
	// 旧版本不支持 color-mix()，必须留一行不被覆盖的兜底底色。
	assert(
		/background:\s*var\(--background-modifier-hover\)/.test(block),
		"空位答案需要为不支持 color-mix() 的版本提供兜底底色"
	);
});

test("样式：选择题的正确项用淡绿打底并保留描边", () => {
	const block = ruleBlock(styles, ".easy-quiz-card__option.is-answer");
	assert(
		/background:\s*color-mix\([^;]*transparent\s*\)/.test(block),
		`正确选项的底色应是半透明淡染，实际：${block.trim()}`
	);
	assert(/border-color:\s*var\(--text-success\)/.test(block), "正确选项应保留绿色描边");
});
