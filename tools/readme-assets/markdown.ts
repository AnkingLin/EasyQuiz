/**
 * 极简 Markdown → HTML。
 *
 * 存在的理由：真实渲染走的是 Obsidian 的 `MarkdownRenderer`，脱离 Obsidian 时
 * `tests/obsidian-stub.ts` 里那个是空实现，题面就会渲染成一片空白。
 *
 * 这里只覆盖 README 夹具真正用到的语法（段落、强调、行内代码、高亮、列表、
 * 链接、标注块），不是一个通用 Markdown 实现——夹具以外的输入不在保证范围内。
 */

/**
 * 行内代码的占位符。
 *
 * 用一个不会出现在正文里的哨兵包住代码内容的序号，处理完其它行内语法后再还原。
 * 刻意不用控制字符（`\u0000`）：那类字符在正则里需要 `no-control-regex` 例外，
 * 而且容易在复制粘贴时丢失。这里用私用区字符，肉眼可见也便于排查。
 */
const TOKEN_OPEN = "\uE000";
const TOKEN_CLOSE = "\uE001";

/** HTML 转义；先转义再套用行内语法，因此 `**` 之类的标记仍然有效。 */
function escapeHtml(text: string): string {
	return text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/**
 * 行内语法。顺序有讲究：行内代码最先处理，因为它的内容是字面量，
 * 不该再被后续的加粗/高亮规则解释。
 */
function inline(source: string): string {
	let text = escapeHtml(source);

	// 行内代码：先抽出来占位，避免内容被别的规则改写。
	const codes: string[] = [];
	text = text.replace(/`([^`]+)`/g, (_match, body: string) => {
		codes.push(body);
		return `${TOKEN_OPEN}${codes.length - 1}${TOKEN_CLOSE}`;
	});

	// 双向链接：`[[目标|别名]]` / `[[目标#小标题]]`
	text = text.replace(/\[\[([^\]]+)\]\]/g, (_match, body: string) => {
		const pipe = body.indexOf("|");
		const target = (pipe >= 0 ? body.slice(0, pipe) : body).trim();
		const label = pipe >= 0 ? body.slice(pipe + 1).trim() : target;
		return `<a class="internal-link" href="${target}">${label}</a>`;
	});
	// 普通链接
	text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

	text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
	text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
	text = text.replace(/==([^=]+)==/g, "<mark>$1</mark>");

	// 还原行内代码
	text = text.replace(new RegExp(`${TOKEN_OPEN}(\\d+)${TOKEN_CLOSE}`, "g"), (_match, index: string) => {
		const body = codes[Number.parseInt(index, 10)] ?? "";
		return `<code>${body}</code>`;
	});
	return text;
}

/** 把一份 Markdown 渲染成 HTML 字符串。 */
export function renderMarkdown(source: string): string {
	const lines = source.replace(/\r\n?/g, "\n").split("\n");
	const out: string[] = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";

		// 空行
		if (line.trim() === "") {
			index++;
			continue;
		}

		// 围栏代码块
		const fence = /^\s*(`{3,}|~{3,})/.exec(line);
		if (fence) {
			const marker = (fence[1] ?? "```").slice(0, 1);
			const body: string[] = [];
			index++;
			while (index < lines.length) {
				const current = lines[index] ?? "";
				if (new RegExp(`^\\s*${marker}{3,}`).test(current)) {
					index++;
					break;
				}
				body.push(current);
				index++;
			}
			out.push(`<pre><code>${escapeHtml(body.join("\n"))}</code></pre>`);
			continue;
		}

		// 标题
		const heading = /^(#{1,6})\s+(.*)$/.exec(line);
		if (heading) {
			const level = (heading[1] ?? "#").length;
			out.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
			index++;
			continue;
		}

		// 标注块（`> [!note]- 标题` + 引用的正文）
		const quote = /^>\s?(.*)$/.exec(line);
		if (quote) {
			const body: string[] = [];
			while (index < lines.length) {
				const current = /^>\s?(.*)$/.exec(lines[index] ?? "");
				if (!current) break;
				body.push(current[1] ?? "");
				index++;
			}
			const first = (body.shift() ?? "").trim();
			const callout = /^\[!(\w+)\][-+]?\s*(.*)$/.exec(first);
			if (callout) {
				const title = (callout[2] ?? "").trim() === "" ? (callout[1] ?? "") : (callout[2] ?? "");
				out.push(
					`<div class="callout"><div class="callout-title">${inline(title)}</div>` +
						`<div class="callout-content">${renderMarkdown(body.join("\n"))}</div></div>`
				);
			} else {
				out.push(`<blockquote>${renderMarkdown(body.join("\n"))}</blockquote>`);
			}
			continue;
		}

		// 无序列表
		if (/^\s*[-*+]\s+/.test(line)) {
			const items: string[] = [];
			while (index < lines.length && /^\s*[-*+]\s+/.test(lines[index] ?? "")) {
				items.push(`<li>${inline((lines[index] ?? "").replace(/^\s*[-*+]\s+/, ""))}</li>`);
				index++;
			}
			out.push(`<ul>${items.join("")}</ul>`);
			continue;
		}

		// 有序列表
		if (/^\s*\d+[.)]\s+/.test(line)) {
			const items: string[] = [];
			while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index] ?? "")) {
				items.push(`<li>${inline((lines[index] ?? "").replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
				index++;
			}
			out.push(`<ol>${items.join("")}</ol>`);
			continue;
		}

		// 段落：一直吃到空行或下一个块级结构
		const paragraph: string[] = [];
		while (index < lines.length) {
			const current = lines[index] ?? "";
			if (current.trim() === "") break;
			if (/^\s*(`{3,}|~{3,})/.test(current)) break;
			if (/^(#{1,6})\s+/.test(current)) break;
			if (/^>\s?/.test(current)) break;
			if (/^\s*[-*+]\s+/.test(current)) break;
			if (/^\s*\d+[.)]\s+/.test(current)) break;
			paragraph.push(current);
			index++;
		}
		out.push(`<p>${inline(paragraph.join(" "))}</p>`);
	}

	return out.join("\n");
}
