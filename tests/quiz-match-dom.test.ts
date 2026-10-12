/**
 * 题板渲染的 DOM 测试（jsdom）。
 *
 * 纯逻辑测试（quiz-match-board）只能验证状态机，验证不了"渲染出来后点击能不能连上"。
 * 这一层调用真实的 renderMatch，按用户的方式点击节点，并检查连线到底画到了哪个节点，
 * 从而覆盖上一轮反复出现的"逻辑对、界面连不上"的问题。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

const { window: testWindow, document } = setupDom();

import { parseQuizFile, ParseOptions } from "../src/parser";
import { contentHash } from "../src/hash";
import { renderMatch, renderQuizCard } from "../src/view";
import { QuizQuestion } from "../src/types";
import { MarkdownRenderer, MarkdownRenderChild } from "./obsidian-stub";
import { assert, assertEqual, test } from "./harness";

const options: ParseOptions = { deps: { parseYaml: (s) => yaml.load(s), hash: contentHash } };

function parseTable(header: string[], rows: string[], intro = ""): QuizQuestion {
	const source = [
		"---",
		"quiz: true",
		"---",
		"",
		"## 配对",
		"",
		...(intro === "" ? [] : [intro, ""]),
		`| ${header.join(" | ")} |`,
		`| ${header.map(() => "---").join(" | ")} |`,
		...rows.map((row) => `| ${row} |`),
		"",
		"```quiz",
		"type: match",
		"```",
	].join("\n");
	return parseQuizFile(source, "题库/测试.md", options).questions[0]!;
}

interface Board {
	columns: HTMLElement[];
	click: (text: string, columnIndex: number) => void;
	/** 连线终点所在列（由坐标推出），用于确认线连到了哪一列。 */
	lineTargets: () => number[];
	linkedTexts: () => string[];
	currentColumn: () => number;
	card: HTMLElement;
}

/** 渲染整张题卡（含 MarkdownRenderer 调用），用于验证渲染契约。 */
async function renderFullCard(
	question: QuizQuestion,
	extra: Partial<Parameters<typeof renderQuizCard>[1]> = {}
): Promise<HTMLElement> {
	const card = document.createElement("div");
	document.body.appendChild(card);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: card,
		blankMarker: "highlight",
		...extra,
	} as unknown as Parameters<typeof renderQuizCard>[1]);
	return card;
}

/** 渲染一块题板，并给每个节点一个可区分的矩形，便于判断连线终点。 */
function renderBoard(question: QuizQuestion): Board {
	const card = document.createElement("div");
	document.body.appendChild(card);
	const ctx = {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: card,
		blankMarker: "highlight",
	} as unknown as Parameters<typeof renderMatch>[2];
	renderMatch(question, card, ctx);

	const columns = [...card.querySelectorAll(".easy-quiz-card__board-col")] as HTMLElement[];
	for (const node of card.querySelectorAll(".easy-quiz-card__node")) {
		const el = node as HTMLElement;
		const column = columns.findIndex((col) => col.contains(el));
		const row = [...(columns[column]?.querySelectorAll(".easy-quiz-card__node") ?? [])].indexOf(el);
		const left = column * 200;
		const top = row * 30;
		el.getBoundingClientRect = () =>
			({
				x: left,
				y: top,
				left,
				top,
				right: left + 100,
				bottom: top + 20,
				width: 100,
				height: 20,
				toJSON: () => ({}),
			});
	}

	const click = (text: string, columnIndex: number): void => {
		const node = [...(columns[columnIndex]?.querySelectorAll(".easy-quiz-card__node") ?? [])].find(
			(candidate) => candidate.textContent === text
		);
		assert(node !== undefined, `列 ${columnIndex} 里应有节点「${text}」`);
		node!.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
	};

	const lineTargets = (): number[] =>
		[...card.querySelectorAll(".easy-quiz-card__link")].map((path) => {
			const d = path.getAttribute("d") ?? "";
			// 终点 x 形如 `... 200 10`：取最后一组坐标里的 x。
			const end = /([\d.]+)\s+([\d.]+)\s*$/.exec(d);
			const x = end?.[1] === undefined ? 0 : Number.parseFloat(end[1]);
			// 节点宽 100、列间距 200：终点 x 落在第 ceil(x/200) 列，至少为 1。
			return Math.max(1, Math.round(x / 200));
		});

	const linkedTexts = (): string[] => {
		const result: string[] = [];
		for (const column of columns) {
			for (const node of column.querySelectorAll(".easy-quiz-card__node")) {
				if (node.classList.contains("is-linked")) result.push(node.textContent ?? "");
			}
		}
		return result;
	};

	const currentColumn = (): number => columns.findIndex((col) => col.classList.contains("is-current"));

	return { columns, click, lineTargets, linkedTexts, currentColumn, card };
}

const header3 = ["协议", "端口", "层级", "缩写"];
const rows3 = ["HTTP | 80 | 应用层 | H", "IP | 0 | 网络层 | I"];

// ---------------------------------------------------------------------------
// 基本渲染
// ---------------------------------------------------------------------------

test("DOM：按列渲染，首列 + 每个答案列各一列", () => {
	const board = renderBoard(parseTable(header3, rows3));
	assertEqual(board.columns.length, 4, "1 个首列 + 3 个答案列");
	assertEqual(board.columns[0]?.querySelector(".easy-quiz-card__board-head")?.textContent, "协议", "首列表头");
	assertEqual(board.columns[3]?.querySelector(".easy-quiz-card__board-head")?.textContent, "缩写", "第四列表头");
});

test("DOM：题面不渲染配对表格本身，只渲染题板", () => {
	const board = renderBoard(parseTable(header3, rows3));
	// 题板由节点组成；不应出现真实的 table 元素（表格由 parse 消费，题面里会被去掉）。
	assertEqual(board.card.querySelectorAll("table").length, 0, "不应渲染 table 元素");
	assert(
		board.card.querySelectorAll(".easy-quiz-card__node").length > 0,
		"应由节点组成题板"
	);
	// 首列表头只在题板列头上出现一次，不应作为普通正文重复出现。
	const heads = [...board.card.querySelectorAll(".easy-quiz-card__board-head")].map((node) => node.textContent);
	assertEqual(heads.join(","), "协议,端口,层级,缩写", "列头应各出现一次");
});

// ---------------------------------------------------------------------------
// 相邻列才能连线（核心规则）
// ---------------------------------------------------------------------------

test("DOM：相邻两列可以连线", () => {
	const board = renderBoard(parseTable(header3, rows3));
	// 协议(0) - 端口(1)
	board.click("HTTP", 0);
	board.click("80", 1);
	assertEqual(board.lineTargets().length, 1, "第 1、2 列应能连线");
	// 端口(1) - 层级(2)
	board.click("80", 1);
	board.click("应用层", 2);
	assertEqual(board.lineTargets().length, 2, "第 2、3 列应能连线");
	// 层级(2) - 缩写(3)
	board.click("应用层", 2);
	board.click("H", 3);
	assertEqual(board.lineTargets().length, 3, "第 3、4 列应能连线");
});

test("DOM：三条连线的终点分别落在列 1、2、3", () => {
	const board = renderBoard(parseTable(header3, rows3));
	for (const [left, leftColumn, right, rightColumn] of [
		["HTTP", 0, "80", 1],
		["80", 1, "应用层", 2],
		["应用层", 2, "H", 3],
	] as const) {
		board.click(left, leftColumn);
		board.click(right, rightColumn);
	}
	const targets = board.lineTargets().sort((a, b) => a - b);
	assertEqual(targets.join(","), "1,2,3", `终点应落在列 1/2/3（实际 ${JSON.stringify(board.lineTargets())}）`);
});

test("DOM：相隔一列的连线被拒绝（第 1 列与第 3 列）", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("应用层", 2);
	assertEqual(board.lineTargets().length, 0, "第 1、3 列不应连成线");
});

test("DOM：第 1 列与第 4 列同样禁止连线", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("H", 3);
	assertEqual(board.lineTargets().length, 0, "跨列连线应被拒绝");
});

test("DOM：同列两个条目不能连线", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("IP", 0);
	assertEqual(board.lineTargets().length, 0, "同列不应连线");
});

test("DOM：从左往右与从右往左得到同一条线", () => {
	const forward = renderBoard(parseTable(header3, rows3));
	forward.click("HTTP", 0);
	forward.click("80", 1);

	const backward = renderBoard(parseTable(header3, rows3));
	backward.click("80", 1);
	backward.click("HTTP", 0);

	assertEqual(forward.lineTargets().length, 1, "从左往右应连成一条");
	assertEqual(backward.lineTargets().length, 1, "从右往左也应连成一条");
	assertEqual(
		forward.lineTargets().join(","),
		backward.lineTargets().join(","),
		"两个方向画出的线应一致"
	);
});

// ---------------------------------------------------------------------------
// 中间列可以连左右两侧
// ---------------------------------------------------------------------------

test("DOM：中间列条目能同时连左右相邻列", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	board.click("80", 1);
	board.click("应用层", 2);
	assertEqual(board.lineTargets().length, 2, "80 应同时连上 协议 与 层级 两列");
});

test("DOM：改动中间列一侧不会丢掉另一侧", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	board.click("80", 1);
	board.click("应用层", 2);
	// 把 80 与 层级 的连接改成 网络层
	board.click("80", 1);
	board.click("网络层", 2);
	assertEqual(board.lineTargets().length, 2, "仍应保留两条连线");
	assertEqual(
		[...board.lineTargets()].sort((a, b) => a - b).join(","),
		"1,2",
		"一条在列 1、一条在列 2"
	);
});

// ---------------------------------------------------------------------------
// 替换与标记
// ---------------------------------------------------------------------------

test("DOM：同一答案可被多个条目连上（合并选项）", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	// 同列的另一个条目也连到 80
	board.click("IP", 0);
	board.click("80", 1);
	assertEqual(board.lineTargets().length, 2, "端口 80 可以挂两条线");
});

test("DOM：再次点击已连线节点只是取消选中，不删线", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	board.click("HTTP", 0);
	assertEqual(board.lineTargets().length, 1, "连线不应被删除");
});

test("DOM：已连线的节点会标记为 is-linked", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	const linked = board.linkedTexts();
	assert(linked.includes("HTTP"), "左节点应标记为已连线");
	assert(linked.includes("80"), "右节点应标记为已连线");
});

test("DOM：全部连满时四条连线（三组相邻列 × 两行）", () => {
	const board = renderBoard(parseTable(header3, rows3));
	for (const [left, leftColumn, right, rightColumn] of [
		["HTTP", 0, "80", 1],
		["IP", 0, "0", 1],
		["80", 1, "应用层", 2],
		["0", 1, "网络层", 2],
		["应用层", 2, "H", 3],
		["网络层", 2, "I", 3],
	] as const) {
		board.click(left, leftColumn);
		board.click(right, rightColumn);
	}
	assertEqual(
		board.lineTargets().length,
		6,
		`三组相邻列各两条，共六条（实际 ${JSON.stringify(board.lineTargets())}）`
	);
});

// ---------------------------------------------------------------------------
// 一对多与重复表头
// ---------------------------------------------------------------------------

test("DOM：一对多（斜杠）时拆出的条目都能连到同一答案", async () => {
	const board = renderBoard(
		parseTable(["数据库", "类型"], ["MySQL / PostgreSQL | 关系型", "Redis | 键值型"])
	);
	assertEqual(board.columns[0]?.querySelectorAll(".easy-quiz-card__node").length, 3, "首列应有三个条目");
	board.click("MySQL", 0);
	board.click("关系型", 1);
	board.click("PostgreSQL", 0);
	board.click("关系型", 1);
	board.click("Redis", 0);
	board.click("键值型", 1);
	// 视图在定时器里补一次绘制，这里等它跑完再断言标记。
	await new Promise((resolve) => testWindow.setTimeout(resolve, 0));
	const linkedLeft = board.columns[0]?.querySelectorAll(".easy-quiz-card__node.is-linked").length ?? 0;
	assertEqual(linkedLeft, 3, "首列三个条目都应标记为已连线");
	const linkedRight = board.columns[1]?.querySelectorAll(".easy-quiz-card__node.is-linked").length ?? 0;
	assertEqual(linkedRight, 2, "两个答案都应标记为已连线");
});

test("DOM：重名表头会给出可区分的列名", () => {
	const question = parseTable(["协议", "层级", "层级"], ["HTTP | 应用层 | 应用层", "IP | 网络层 | 网络层"]);
	const names = question.board.map((column) => column.name);
	assertEqual(names.length, 3, "三列表格三列");
	assert(names[1] !== names[2], `两个同名列名不应相同（实际：${JSON.stringify(names)}）`);
});

// ---------------------------------------------------------------------------
// 渲染契约：Obsidian 要求 render 必须收到 Component
// ---------------------------------------------------------------------------

test("DOM：渲染题面时必须传入 Component（不能是 null）", async () => {
	MarkdownRenderer.calls.length = 0;
	await renderFullCard(parseTable(header3, rows3, "把协议与端口配对。"));
	assert(MarkdownRenderer.calls.length > 0, "应调用过 MarkdownRenderer.render");
	for (const call of MarkdownRenderer.calls) {
		assert(call.component !== null && call.component !== undefined, "Component 不能为空");
	}
});

test("DOM：题面为空时不调用 render（也就不会踩到 Component 缺失）", async () => {
	// 配对题的题面可能只剩表格，去掉表格后为空。
	MarkdownRenderer.calls.length = 0;
	await renderFullCard(parseTable(header3, rows3));
	assertEqual(MarkdownRenderer.calls.length, 0, "题面为空时不应调用 render");
});

test("DOM：未提供 Component 时插件会自己创建并交给渲染上下文", async () => {
	MarkdownRenderer.calls.length = 0;
	const registered: unknown[] = [];
	await renderFullCard(parseTable(header3, rows3, "把协议与端口配对。"), {
		addRenderChild: (child) => registered.push(child),
	});
	assertEqual(registered.length, 1, "应注册一个自建的 MarkdownRenderChild");
	assert(MarkdownRenderer.calls[0]?.component === registered[0], "render 应使用该 Component");
});

test("DOM：传入 Component 时直接使用它，不再自建", async () => {
	MarkdownRenderer.calls.length = 0;
	const registered: unknown[] = [];
	const component = new MarkdownRenderChild(document.createElement("div"));
	await renderFullCard(parseTable(header3, rows3, "把协议与端口配对。"), {
		renderComponent: component,
		addRenderChild: (child) => registered.push(child),
	});
	assertEqual(registered.length, 0, "已有 Component 时不应再自建");
	assert(MarkdownRenderer.calls[0]?.component === component, "应使用传入的 Component");
});

// ---------------------------------------------------------------------------
// 实际报告过的表格：首列有重复行，答案列里混进了“测试”
// ---------------------------------------------------------------------------

const userHeader = ["协议", "端口", "测试"];
const userRows = ["HTTP | 80 | 2", "HTTPS | 443 | 3", "SSH | 22 | 4", "HTTPS | 测试 | 测试"];

test("DOM：首列重复的行只产生一个节点", () => {
	const board = renderBoard(parseTable(userHeader, userRows));
	const leftTexts = [...(board.columns[0]?.querySelectorAll(".easy-quiz-card__node") ?? [])].map(
		(node) => node.textContent ?? ""
	);
	assertEqual(leftTexts.length, 3, `首列应有三个条目（实际 ${JSON.stringify(leftTexts)}）`);
	assertEqual(new Set(leftTexts).size, leftTexts.length, "不应出现两个同名节点");
	assertEqual([...leftTexts].sort().join(","), "HTTP,HTTPS,SSH", "三个条目");
});

test("DOM：首列重复的行在相邻列都能连上", () => {
	const board = renderBoard(parseTable(userHeader, userRows));
	// 协议(0) - 端口(1)
	for (const [left, answer] of [
		["HTTP", "80"],
		["HTTPS", "443"],
		["SSH", "22"],
	] as const) {
		board.click(left, 0);
		board.click(answer, 1);
	}
	assertEqual(board.lineTargets().length, 3, "第 1、2 列之间应有三条连线");

	// 端口(1) - 测试(2)
	for (const [left, answer] of [
		["80", "2"],
		["443", "3"],
		["22", "4"],
	] as const) {
		board.click(left, 1);
		board.click(answer, 2);
	}
	assertEqual(
		board.lineTargets().length,
		6,
		`第 2、3 列之间应再有三条（实际 ${JSON.stringify(board.lineTargets())}）`
	);
});