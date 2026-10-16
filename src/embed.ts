/**
 * 题目嵌入（纯逻辑，不依赖 obsidian）。
 *
 * 让 `![[题库#题目]]` 在别的笔记里直接渲染成可作答的题卡。
 *
 * **为什么不能只靠 Obsidian 自己的 embed。** 它把 `![[笔记#小标题]]` 解析成「该小标题
 * 之下的正文」再按普通 Markdown 渲染，而题库的题面长这样：
 *
 *     ## 三次握手 ^[[[计算机网络/传输层#TCP 三次握手]]]
 *     - 选项一 ^a
 *     ```quiz
 *     type: single
 *     answer: a
 *     ```
 *
 * 于是有两个后果：
 *
 *   1. 就算命中标题，嵌进来的也是「选项列表 + `quiz` 数据块」的原文而不是题卡，
 *      选项会与题卡各出现一次；
 *   2. `![[题库#三次握手]]` 其实**命中不了**——Obsidian 比对标题时先把标点换成空格
 *      （`TD`），于是标题被算成「三次握手 计算机网络 传输层 TCP 三次握手」，子路径
 *      找不到时它会退化成**整份文件**都渲染出来（`PD` 返回 null → 不裁剪正文）。
 *
 * 所以插件自己认这件事：从 embed 的 `src`（形如 `路径#子路径`）拆出目标与子路径，
 * 按题面标题找回题目，整块换成题卡。判定与查找都在这里（纯逻辑、可单测），
 * DOM 替换与渲染留在 `main.ts`。
 */

import { stripKnowledgeLink } from "./parser";
import { ParsedQuizFile, QuizQuestion } from "./types";

/** 一个 embed 的目标：文件路径 + 子路径（`#` 之后的部分，不含 `#`）。 */
export interface EmbedTarget {
	path: string;
	subpath: string;
}

/** 标题条目；与 Obsidian `metadataCache` 的 `headings` 同形，可直接传进来。 */
export interface HeadingRef {
	heading: string;
	level: number;
}

/**
 * 拆开 embed 的 `src` 属性。
 *
 * Obsidian 写入的 `src` 就是 wikilink 里 `[[` 与 `]]` 之间的内容（去掉 `|别名`），
 * 因此形如 `文件夹/题库#三次握手`。没有 `#` 时子路径为空字符串。
 *
 * **只按第一个 `#` 切分**，与 Obsidian 自己的 `wD` 完全一致。这意味着路径里不能含
 * `#`（`![[语言/C# 入门#历史]]` 的目标会被解析成 `语言/C`）——这是 Obsidian 既有的
 * 解析方式，插件跟随它而不是另立一套规则，否则同一个链接在嵌入与其它功能里会指到
 * 不同的文件。
 */
export function splitEmbedSrc(src: string): EmbedTarget {
	const trimmed = src.trim();
	const hash = trimmed.indexOf("#");
	if (hash < 0) return { path: trimmed, subpath: "" };
	return { path: trimmed.slice(0, hash).trim(), subpath: trimmed.slice(hash + 1).trim() };
}

/**
 * 标题比对用的归一化键。
 *
 * 标点集合与空白折叠规则对齐 Obsidian 自己比对标题的做法，
 * 但**在去标点之前**先摘掉题面末尾的知识点链接——那串 `^[[[路径#标题]]]` 会把归一化
 * 结果彻底带偏，正是 `![[题库#三次握手]]` 对不上 `## 三次握手 ^[[[……]]]` 的原因。
 */
export function normalizeHeadingKey(text: string): string {
	return stripKnowledgeLink(text)
		.normalize("NFC")
		// 标点集合与 Obsidian 的 `SD` 正则保持一致（去标点 → 空白 → 折叠 → 小写）。
		.replace(/[!"#$%&()*+,.:;<=>?@^`{|}~/[\]\\\r\n]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

/**
 * 这个子路径是否像「引用了某道题」。
 *
 * 空子路径（`![[整份题库]]`）与块引用（`#^blockid`）、脚注引用都不接管：
 * 那些是 Obsidian 自己的语义，插件插手只会把正常用法弄坏。
 */
export function looksLikeQuestionRef(subpath: string): boolean {
	if (subpath === "") return false;
	if (subpath.startsWith("^")) return false;
	if (subpath.startsWith("[^")) return false;
	return true;
}

/**
 * 目标标题是否就是某道题的题面标题。
 *
 * 这是**同步**判定，必须在解析文件之前跑完：Obsidian 加载 embed 紧跟在所有后处理器
 * 之后，插件要抢在它前面把 embed 接管下来，否则一个命中不了标题的题库 embed 会先把
 * 整份文件渲染一遍（见文件头说明）。因此这里只用 `metadataCache` 的标题索引。
 *
 * 比对分两种形态，因为 `metadataCache` 里的标题文本可能是原文、也可能是渲染后的纯文本：
 *
 *   - **原文**（`AD` 的兜底分支）：`三次握手 ^[[[计算机网络/传输层#TCP 三次握手]]]`。
 *     {@link normalizeHeadingKey} 会先摘掉末尾链接，于是能精确比中。
 *   - **纯文本**：链接被渲染成文字接在后面，形如 `三次握手 计算机网络 传输层 TCP 三次握手`。
 *     这时按「整词前缀」再比一次（要求后面紧跟空格），因此 `三次握手简介` 这种
 *     更长的标题不会被误认成 `三次握手`。
 *
 * 还要求标题层级落在题面层级区间内：题面里更深一级的子标题（默认配置下的 H3）不是
 * 题目，不能因为它存在就把 embed 吃掉。
 */
export function matchesQuestionHeading(
	subpath: string,
	headings: readonly HeadingRef[],
	levels: readonly [number, number]
): boolean {
	const wanted = normalizeHeadingKey(subpath);
	if (wanted === "") return false;
	const [min, max] = levels;
	return headings.some((heading) => {
		if (heading.level < min || heading.level > max) return false;
		const got = normalizeHeadingKey(heading.heading);
		return got === wanted || got.startsWith(`${wanted} `);
	});
}

/**
 * 在解析结果里按子路径找回题目。
 *
 * 用归一化后的题面标题比对。找不到时返回 null——调用方应当把 embed 恢复成常规渲染，
 * 绝不把内容吃掉。
 */
export function findEmbeddedQuestion(parsed: ParsedQuizFile, subpath: string): QuizQuestion | null {
	if (!looksLikeQuestionRef(subpath)) return null;
	const wanted = normalizeHeadingKey(subpath);
	if (wanted === "") return null;
	return parsed.questions.find((question) => normalizeHeadingKey(question.title) === wanted) ?? null;
}

/** 题卡容器的类名；`styles.css` 与测试都按它定位。 */
export const EMBED_HOST_CLASS = "easy-quiz-embed";

/**
 * 这个 embed 是否已经位于一张已渲染的题卡里。
 *
 * 用来**掐断递归**：题卡渲染题面时会调用 `MarkdownRenderer.render`，而它会把后处理器
 * 再跑一遍，所以题面里如果又出现 `![[题库#题目]]`，本处理器会再次接管并再渲染一张卡……
 * 一道引用自己的题（或互相引用的两道题）就会无限递归下去。
 *
 * Obsidian 自己用「嵌入深度」限制同类问题；这里用 DOM 位置做判断，不需要可变状态，
 * 因此不受并发渲染的顺序影响：**一张卡里不再套题卡**。题目题面本来就是散文，
 * 里面再嵌一道题没有实际用途，拒绝它换来的是"绝不会递归"这个确定性。
 */
export function isInsideQuizCard(el: HTMLElement): boolean {
	return el.closest(`.${EMBED_HOST_CLASS}`) !== null;
}

/**
 * 把一个 embed 元素就地改造成题卡容器，并返回它。
 *
 * 两个决定，都有原因：
 *
 * 1. **改造传入的这个元素本身**，不新建、也不向上找 `.markdown-embed`。Obsidian 把
 *    `markdown-embed` 加在 `.internal-embed` 这个**同一个**容器上（`containerEl.addClass`），
 *    而那一刻发生在本插件的后处理器之后；替换的时机更早，此时祖先里唯一的
 *    `.markdown-embed` 只可能是**外层**的另一个嵌入。向上找的后果是：一道题里嵌了另一道题
 *    （或任何嵌在嵌入内容里的题）时，会把外层整块内容一起删掉。
 *
 * 2. **摘掉 `internal-embed` 这个类名**，这是让 Obsidian 不再加载这块嵌入的关键。
 *    Obsidian 在跑完后处理器之后才去找 `.internal-embed:not(.is-loaded)` 并逐个载入，
 *    类名没了就找不到，也就不会把题库原文（选项列表 + `quiz` 数据块）再渲染一遍。
 *    就地改造还免去了 DOM 增删，阅读视图重渲染时更不容易抖。
 */
export function claimEmbedHost(embed: HTMLElement): HTMLElement {
	embed.classList.remove("internal-embed");
	embed.classList.add(EMBED_HOST_CLASS);
	// 清掉 Obsidian 可能已经放进去的落点内容（例如嵌入标题），题卡自己会画。
	embed.textContent = "";
	return embed;
}
