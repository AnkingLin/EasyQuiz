/**
 * 选项 / 条目的**显示**用纯文本（纯逻辑，不依赖 obsidian）。
 *
 * 为什么需要它：选项在题卡上是按 Markdown 渲染的（见 `view.ts` 的 `renderChoice`），
 * 但复盘列表、判分提示这些地方只放一行纯文本，不能渲染 Markdown。如果直接用
 * `normalizeText`（那个函数为匹配而写，会把 `*_`~` 一并删掉），`H~2~O` 就会在提示里
 * 显示成 `H2O`——「`~` 消失」的另一种表现。
 *
 * 因此这里只去掉**成对**的 Markdown 标记，单独的 `~`、`_` 一律保留：
 * `H~2~O` 原样留下，而 `~~删除线~~`、`**加粗**` 这类真标记会被剥掉。
 */

/** 取显示用纯文本：剥掉成对的 Markdown 标记，其余字符原样保留。 */
export function plainText(markdown: string): string {
	let text = markdown;

	// 行内代码：内容原样取出。
	text = text.replace(/`+([^`]*)`+/g, "$1");
	// 加粗、删除线、高亮：都是「成对标记」，成对才剥。
	text = text.replace(/\*\*([^*]+)\*\*/g, "$1");
	text = text.replace(/~~([^~]+)~~/g, "$1");
	text = text.replace(/==([^=]+)==/g, "$1");
	// 斜体：只在不成对的双星号之外生效，避免把 `2 * 3 * 4` 当强调。
	text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2");
	// 双链与普通链接：留下可读的文字部分。
	text = text.replace(/\[\[([^\]|]*)\|([^\]]+)\]\]/g, "$2");
	text = text.replace(/\[\[([^\]]+)\]\]/g, "$1");
	text = text.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");

	return text.replace(/\s+/g, " ").trim();
}
