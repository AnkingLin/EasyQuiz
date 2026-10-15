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

/** 取出某个选择器的声明块（不要求含 background，供纯几何声明使用）。 */
function anyRuleBlock(css: string, selector: string): string {
	const start = css.indexOf(`\n${selector} {`);
	assert(start >= 0, `样式表里找不到规则 ${selector}`);
	const open = css.indexOf("{", start);
	const close = css.indexOf("}", open);
	assert(open > 0 && close > open, `${selector} 的规则块不完整`);
	return css.slice(open + 1, close);
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

/** 取出 `@media (max-width: 640px)` 的整段规则（窄屏布局都写在这里）。 */
function mobileBlock(css: string): string {
	const start = css.indexOf("@media (max-width: 640px)");
	assert(start >= 0, "样式表里找不到 640px 的窄屏断点");
	const open = css.indexOf("{", start);
	assert(open > 0, "窄屏断点的规则块不完整");
	// 逐字符配平大括号：媒体查询里面还嵌着一层规则块，不能用第一个 `}` 收尾。
	let depth = 0;
	for (let index = open; index < css.length; index++) {
		if (css[index] === "{") depth++;
		else if (css[index] === "}") {
			depth--;
			if (depth === 0) return css.slice(open + 1, index);
		}
	}
	throw new Error("窄屏断点的规则块不完整");
}

/** 从一段样式片段里取出某个选择器的声明块（片段里的规则是缩进的）。 */
function nestedRuleBlock(scope: string, selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{`);
	const match = pattern.exec(scope);
	// 不用 assert：TS 无法从它推断出非空，后面的 match.index 会报错。
	if (match === null) throw new Error(`窄屏样式里找不到规则 ${selector}`);
	const open = scope.indexOf("{", match.index);
	const close = scope.indexOf("}", open);
	assert(open > 0 && close > open, `${selector} 的规则块不完整`);
	return scope.slice(open + 1, close);
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

/**
 * 折叠箭头指向。
 *
 * 箭头是用边框拼的三角形：基准态必须**朝下**（展开），折叠态旋转成**朝右**。
 * 这两个方向恰好相反，写反了界面就会"展开时显示折叠箭头"——而 jsdom 没有渲染，
 * 只有截图才看得出来，因此这里直接对声明做断言。
 */
test("样式：文件夹箭头展开时朝下、折叠时朝右", () => {
	const caret = anyRuleBlock(styles, ".easy-quiz-practice__folder-caret");
	assert(/border-top:\s*\d+px solid currentColor/.test(caret), `箭头基准态应朝下（用 border-top 画尖），实际：${caret.trim()}`);
	assert(!/border-left:\s*\d+px solid currentColor/.test(caret), "基准态不应是朝右的三角");

	const folded = anyRuleBlock(styles, ".easy-quiz-practice__group.is-folded .easy-quiz-practice__folder-caret");
	assert(/rotate\(-90deg\)/.test(folded), `折叠时应把朝下的箭头旋转成朝右，实际：${folded.trim()}`);
});

/**
 * 工具条不能靠 `margin-left: auto` 定位。
 *
 * 页头的工具条与标题同处一行，而 flex 容器在"这一行放不下、提前换行"时，会把正的
 * 剩余空间全部算进 auto 外边距：工具条一旦换到第二行，那 140 多 px 的外边距会跟着
 * 一起过去，表现为左侧凭空缩进。这是纯排版问题，jsdom 里量不出来（没有布局引擎），
 * 只能对声明做断言：定位必须走 align-self（只作用于交叉轴，换行前后都不变）。
 */
test("样式：工具条不靠 auto 外边距定位（换行后会凭空缩进）", () => {
	const block = anyRuleBlock(styles, ".easy-quiz-practice__toolbar");
	assert(
		!/margin-left:\s*auto/.test(block),
		`工具条不应使用 margin-left: auto 贴右——注意 flex 换行时它会变成缩进，实际：${block.trim()}`
	);
	assert(
		/align-self:\s*flex-start/.test(block),
		`工具条应靠 align-self: flex-start 与行首对齐，实际：${block.trim()}`
	);
});

/**
 * 窄屏下"换行占满整行"要用 `width: 100%` 而不是 `flex-basis: 100%`。
 *
 * 工具条既可能是行方向容器（页头）的子项，也可能是列方向容器（设置面板、成绩单）
 * 的子项：百分比 flex-basis 在后者身上指的是高度，会把面板撑高。这两条规则一起
 * 保证"行方向换行、列方向铺满"两种情形都对。
 */
test("样式：窄屏工具条用 width 而非 flex-basis 换行", () => {
	const block = nestedRuleBlock(mobileBlock(styles), ".easy-quiz-practice__toolbar");
	assert(/width:\s*100%/.test(block), `窄屏工具条应显式声明 width: 100%，实际：${block.trim()}`);
	assert(
		!/flex(-basis)?:[^;]*\b100%/.test(block),
		`窄屏工具条不该用 flex-basis: 100%——工具条也可能是列方向容器的子项，百分比会落到高度上，实际：${block.trim()}`
	);
	assert(!/margin-left/.test(block), "窄屏工具条不需要再覆盖外边距（基准规则里已经没有了）");
});

/**
 * 文件行在窄屏必须"勾选框 + 文字"稳定地排在同一行。
 *
 * `__file-main` 的 flex 基准默认取内容宽度，而 flex 容器判断"这一项还放不放得下"看的
 * 正是基准尺寸：路径稍长的文件行会被挤到第二行，于是同一份清单里有的文件行缩进 12px、
 * 有的缩进 40px。基准归零（flex: 1 1 0）之后所有行都一致。
 */
test("样式：窄屏文件行的正文基准归零（否则长短路径缩进不一致）", () => {
	const block = nestedRuleBlock(mobileBlock(styles), ".easy-quiz-practice__file-main");
	assert(
		/flex:\s*1 1 0\b/.test(block),
		`窄屏下 __file-main 的 flex-basis 应为 0，否则路径长度会决定它换不换行，实际：${block.trim()}`
	);
});

/** 跳题输入框要和同排的导航按钮一样高，否则行内居中会让它上下各差一截。 */
test("样式：窄屏跳题输入框与导航按钮等高（44px）", () => {
	const mobile = mobileBlock(styles);
	const nav = nestedRuleBlock(mobile, ".easy-quiz-practice__nav button");
	const jump = nestedRuleBlock(mobile, ".easy-quiz-practice__jump");
	const navHeight = /min-height:\s*(\d+)px/.exec(nav);
	// 同上：assert 不做类型收窄，这里用显式判断。
	if (navHeight === null) throw new Error(`导航按钮应声明 min-height，实际：${nav.trim()}`);
	const expected = navHeight[1];
	assert(
		new RegExp(`min-height:\\s*${expected}px`).test(jump),
		`跳题输入框的高度应与导航按钮一致（${expected}px），实际：${jump.trim()}`
	);
});
