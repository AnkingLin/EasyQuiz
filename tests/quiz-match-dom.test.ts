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
import { renderMatch } from "../src/view";
import { QuizQuestion } from "../src/types";
import { assert, assertEqual, test } from "./harness";

const options: ParseOptions = { deps: { parseYaml: (s) => yaml.load(s), hash: contentHash } };

function parseTable(header: string[], rows: string[]): QuizQuestion {
	const source = [
		"---",
		"quiz: true",
		"---",
		"",
		"## 配对",
		"",
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
			// 终点 x 坐标形如 ... 200 10，取最后一个数字对里的 x
			const end = /([\d.]+)\s+([\d.]+)\s*$/.exec(d);
			const x = end?.[1] === undefined ? 0 : Number.parseFloat(end[1]);
			// 每个节点宽 100、列间距 200：终点 x 落在哪一列
			return Math.round((x - 100) / 200);
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
// 每一列都必须能连上（报告过：第 2、3 列连不上）
// ---------------------------------------------------------------------------

test("DOM：左条目可以连到每一个答案列（第 2、3 列同样可以）", () => {
	const board = renderBoard(parseTable(header3, rows3));

	board.click("HTTP", 0);
	board.click("80", 1);
	assertEqual(board.lineTargets().length, 1, "第 1 条答案列连线");

	board.click("HTTP", 0);
	board.click("应用层", 2);
	assertEqual(board.lineTargets().length, 2, "第 2 条答案列连线");

	board.click("HTTP", 0);
	board.click("H", 3);
	assertEqual(board.lineTargets().length, 3, "第 3 条答案列连线");
});

test("DOM：三条连线分别指向三个不同的答案列", () => {
	const board = renderBoard(parseTable(header3, rows3));
	for (const [text, column] of [
		["80", 1],
		["应用层", 2],
		["H", 3],
	] as const) {
		board.click("HTTP", 0);
		board.click(text, column);
	}
	const targets = board.lineTargets().sort((a, b) => a - b);
	assertEqual(targets.join(","), "1,2,3", `三条线应分别指向列 1/2/3（实际 ${JSON.stringify(board.lineTargets())}）`);
});

test("DOM：连线到哪一列，就高亮哪一列", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("应用层", 2);
	assertEqual(board.currentColumn(), 2, "应高亮第 2 个答案列");
});

test("DOM：每一列都能连满所有条目", () => {
	for (const columnIndex of [1, 2, 3]) {
		const board = renderBoard(parseTable(header3, rows3));
		const answers = [...(board.columns[columnIndex]?.querySelectorAll(".easy-quiz-card__node") ?? [])].map(
			(node) => node.textContent ?? ""
		);
		assertEqual(answers.length, 2, `列 ${columnIndex} 应有两个答案`);
		board.click("HTTP", 0);
		board.click(answers[0]!, columnIndex);
		board.click("IP", 0);
		board.click(answers[1]!, columnIndex);
		assertEqual(board.lineTargets().length, 2, `列 ${columnIndex} 应能连满两条`);
	}
});

// ---------------------------------------------------------------------------
// 每列独立、不互相覆盖（报告过：跨列连接）
// ---------------------------------------------------------------------------

test("DOM：操作第 3 列不会影响第 1 列已有的连线", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	assertEqual(board.lineTargets().length, 1, "第 1 列已有一条");

	board.click("HTTP", 0);
	board.click("H", 3);
	const targets = board.lineTargets().sort((a, b) => a - b);
	assertEqual(targets.join(","), "1,3", "两条线应分别在第 1 列与第 3 列，互不覆盖");
});

test("DOM：三列都连满后共六条连线", () => {
	const board = renderBoard(parseTable(header3, rows3));
	for (const [columnIndex, first, second] of [
		[1, "80", "0"],
		[2, "应用层", "网络层"],
		[3, "H", "I"],
	] as const) {
		board.click("HTTP", 0);
		board.click(first, columnIndex);
		board.click("IP", 0);
		board.click(second, columnIndex);
	}
	assertEqual(board.lineTargets().length, 6, `三列两行共六条连线（实际 ${JSON.stringify(board.lineTargets())}）`);
});

test("DOM：同列替换时始终保留一条连线", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	board.click("HTTP", 0);
	board.click("0", 1);
	assertEqual(board.lineTargets().length, 1, "同列里一个条目只保留一条线");
	assertEqual(board.lineTargets()[0], 1, "应仍在第 1 列");
});

test("DOM：另一列改动不会动到本列", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	// 在第 2 列把 HTTP 改连到另一个答案
	board.click("HTTP", 0);
	board.click("应用层", 2);
	board.click("HTTP", 0);
	board.click("网络层", 2);
	const targets = board.lineTargets().sort((a, b) => a - b);
	assertEqual(targets.join(","), "1,2", "第 1 列一条、第 2 列一条");
});

test("DOM：先点右侧再点左侧也能连上", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("应用层", 2);
	board.click("HTTP", 0);
	assertEqual(board.lineTargets().length, 1, "应连成一条");
	assertEqual(board.lineTargets()[0], 2, "应连到第 2 列");
});

test("DOM：已连线的节点会标记为 is-linked", () => {
	const board = renderBoard(parseTable(header3, rows3));
	board.click("HTTP", 0);
	board.click("80", 1);
	const linked = board.linkedTexts();
	assert(linked.includes("HTTP"), "左节点应标记为已连线");
	assert(linked.includes("80"), "右节点应标记为已连线");
});

// ---------------------------------------------------------------------------
// 一对多与重复表头
// ---------------------------------------------------------------------------

test("DOM：一对多（斜杠）时首列每个条目都能连到自己那一列", () => {
	const board = renderBoard(
		parseTable(
			["数据库", "类型", "用途"],
			["MySQL / PostgreSQL | 关系型 | 存储", "Redis | 键值型 | 缓存"]
		)
	);
	assertEqual(board.columns[0]?.querySelectorAll(".easy-quiz-card__node").length, 3, "首列应有三个条目");
	board.click("PostgreSQL", 0);
	board.click("关系型", 1);
	board.click("Redis", 0);
	board.click("键值型", 1);
	assertEqual(board.lineTargets().length, 2, "两个条目都应能连上");
});

test("DOM：重名表头会给出可区分的列名", () => {
	const question = parseTable(["协议", "层级", "层级"], ["HTTP | 应用层 | 应用层", "IP | 网络层 | 网络层"]);
	const names = question.matchColumns.map((column) => column.name);
	assertEqual(names.length, 2, "应有两个答案列");
	assert(names[0] !== names[1], `两个列名不应相同（实际：${JSON.stringify(names)}）`);
});
