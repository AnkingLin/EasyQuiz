/**
 * 选择题**打乱选项**的测试（jsdom）。
 *
 * 钉住报告里的第二个 bug：刷题设置的「打乱顺序」没能作用到选项上，而且选项换位后
 * 还得认得出正确答案。三条要求：
 *
 *   1. 打开开关（或题目自带 `shuffle: true`）后选项顺序真的变了，且不增删选项；
 *   2. 顺序在同一轮里**可复现**——复盘重画、上一题/下一题来回切都不跳位，
 *      否则用户刚记住的位置就变了，看起来像"答案认错了"；
 *   3. 判分与复盘始终按**锚点**，因此换位不会改变什么算对。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

const { window: testWindow, document } = setupDom();

import { parseQuizFile, ParseOptions } from "../src/parser";
import { contentHash } from "../src/hash";
import { renderQuizCard } from "../src/view";
import { QuizQuestion } from "../src/types";
import { assert, assertEqual, must, test } from "./harness";

const options: ParseOptions = { deps: { parseYaml: (s) => yaml.load(s), hash: contentHash } };

function parse(source: string): QuizQuestion {
	return must(parseQuizFile(source, "题库/测试.md", options).questions[0], "未解析出题目");
}

/**
 * 一道五选一：用来观察选项顺序。
 *
 * 显式写 `id: five`：打乱顺序由「题面哈希」派生，给了固定 id 之后这道题的顺序就是
 * 确定的（见 `shuffleOptionOrder`），断言因此不会随夹具改名而随机失效。
 */
const FIVE = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 五选一",
	"",
	"- 甲 ^a",
	"- 乙 ^b",
	"- 丙 ^c",
	"- 丁 ^d",
	"- 戊 ^e",
	"",
	"```quiz",
	"id: five",
	"type: single",
	"answer: c",
	"```",
].join("\n");

/** 同一道题，但题目自己声明了 `shuffle: true`（不依赖刷题窗口的开关）。 */
const FIVE_SHUFFLED = FIVE.replace("id: five", "id: five\nshuffle: true");

async function render(
	question: QuizQuestion,
	extra: Partial<Parameters<typeof renderQuizCard>[1]> = {}
): Promise<HTMLElement> {
	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
		...extra,
	} as unknown as Parameters<typeof renderQuizCard>[1]);
	return host;
}

/** 渲染后按 DOM 顺序读出选项的锚点。 */
function renderedOrder(host: HTMLElement, question: QuizQuestion): string[] {
	const texts = [...host.querySelectorAll(".easy-quiz-card__option")].map(
		(row) => row.textContent ?? ""
	);
	return texts.map((text) => {
		const option = question.options.find((item) => plainOf(item.text) === plainOf(text));
		return option?.anchor ?? `?${text}`;
	});
}

/** 粗糙的纯文本比较：去掉空白即可，选项内容在测试夹具里没有 Markdown 标记。 */
function plainOf(text: string): string {
	return text.replace(/\s+/g, "");
}

test("DOM：不打开打乱时选项保持作者顺序", async () => {
	const question = parse(FIVE);
	const host = await render(question);
	assertEqual(renderedOrder(host, question).join(","), "a,b,c,d,e", "默认应保持原顺序");
});

test("DOM：打开打乱后选项顺序变化，但集合不变", async () => {
	const question = parse(FIVE);
	const host = await render(question, { shuffleOptions: true, shuffleSeed: 12345 });
	const order = renderedOrder(host, question);
	assertEqual([...order].sort().join(","), "a,b,c,d,e", "打乱不应增删选项");
	assert(order.join(",") !== "a,b,c,d,e", `五个选项应被打乱（实际 ${order.join(",")}）`);
});

/**
 * 顺序必须可复现：复盘重画、上一题/下一题来回切都会重新渲染同一道题，
 * 每次换一副牌的话用户刚记住的位置就变了，看起来像"答案认错了"。
 */
test("DOM：同一个种子得到同一套选项顺序", async () => {
	const question = parse(FIVE);
	const first = await render(question, { shuffleOptions: true, shuffleSeed: 777 });
	const second = await render(question, { shuffleOptions: true, shuffleSeed: 777 });
	assertEqual(
		renderedOrder(first, question).join(","),
		renderedOrder(second, question).join(","),
		"同种子应得到同一顺序"
	);
});

test("DOM：不同种子（换一轮）才重新洗牌", async () => {
	const question = parse(FIVE);
	const orders = new Set<string>();
	for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
		const host = await render(question, { shuffleOptions: true, shuffleSeed: seed });
		orders.add(renderedOrder(host, question).join(","));
	}
	assert(orders.size > 1, `不同种子应产生不同顺序（实际只有 ${orders.size} 种）`);
});

/** 题目自己写的 `shuffle: true` 也要生效，不必依赖窗口开关。 */
test("DOM：题目自带的 shuffle: true 就会打乱选项", async () => {
	const question = parse(FIVE_SHUFFLED);
	assertEqual(question.shuffle, true, "夹具应解析出 shuffle: true");
	const host = await render(question);
	const order = renderedOrder(host, question);
	assertEqual([...order].sort().join(","), "a,b,c,d,e", "集合不变");
	assert(order.join(",") !== "a,b,c,d,e", `shuffle: true 应打乱选项（实际 ${order.join(",")}）`);
});

/**
 * 最关键的一条：**打乱后仍然按锚点判分**。
 * 点"文本为丙的那一行"（正确答案 c）在打乱前后都应判对。
 */
test("DOM：打乱选项后，点正确的那一项仍提交正确的锚点", async () => {
	const question = parse(FIVE);
	const submitted: { anchors: string[] }[] = [];
	const service = {
		submit: async (_file: unknown, _id: string, answer: { anchors: string[] }) => {
			submitted.push(answer);
			// 与 grade.ts 一致：按锚点集合判对错。
			const correct = [...answer.anchors].sort().join(",") === ["c"].sort().join(",");
			return { correct, details: [{ correct }], recorded: answer.anchors };
		},
	};
	const host = await render(question, {
		shuffleOptions: true,
		shuffleSeed: 2024,
		service: service as never,
	});

	const rows = [...host.querySelectorAll<HTMLElement>(".easy-quiz-card__option")];
	const target = must(
		rows.find((row) => plainOf(row.textContent ?? "") === "丙"),
		`打乱后仍应能找到「丙」（实际 ${rows.map((row) => row.textContent).join("|")}）`
	);
	target.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
	const submit = must(
		host.querySelector<HTMLElement>(".easy-quiz-card__actions button") ?? undefined,
		"缺少提交按钮"
	);
	submit.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
	for (let i = 0; i < 8; i++) await Promise.resolve();

	assertEqual(submitted.length, 1, "应提交一次");
	assertEqual(submitted[0]?.anchors.join(","), "c", "打乱后点「丙」仍应提交锚点 c");
	assert((host.textContent ?? "").includes("回答正确"), `应判对（实际：${host.textContent}）`);
});

/**
 * 「打乱后认不出正确答案」是报告里最要命的一半。两条路径都要按**锚点**给出答案，
 * 而不是按选项在页面上的位置：
 *
 *   - 提交后的复盘列表（`reviewAnswers`）写出「锚点（选项文字）」；
 *   - 复盘态（刷题窗口的重画）把正确答案那一行标成 `is-answer`。
 */
test("DOM：打乱选项后，复盘列表写出的仍是正确答案", async () => {
	const question = parse(FIVE);
	const service = {
		submit: async () => ({ correct: true, details: [{ correct: true }], recorded: ["c"] }),
	};
	const host = await render(question, {
		shuffleOptions: true,
		shuffleSeed: 999,
		service: service as never,
	});

	// 先确认这次真的换了顺序，否则这条断言没有意义。
	const before = [...host.querySelectorAll<HTMLElement>(".easy-quiz-card__option")].map(
		(row) => row.textContent
	);
	assert(before[2] !== "丙", `这次打乱应把「丙」移出第三位（实际 ${before.join(",")}）`);

	const rows = [...host.querySelectorAll<HTMLElement>(".easy-quiz-card__option")];
	rows.forEach((row) => row.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true })));
	const submit = must(host.querySelector<HTMLElement>(".easy-quiz-card__actions button") ?? undefined, "缺少提交按钮");
	submit.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
	for (let i = 0; i < 8; i++) await Promise.resolve();

	const answers = [...host.querySelectorAll<HTMLElement>(".easy-quiz-card__review-list li")].map(
		(node) => node.textContent ?? ""
	);
	assertEqual(answers.length, 1, `复盘应列出一条正确答案（实际 ${JSON.stringify(answers)}）`);
	assert(answers[0]?.includes("丙"), `复盘应写出正确选项「丙」（实际：${answers[0]}）`);
	assert(answers[0]?.startsWith("c"), `复盘应带上锚点 c（实际：${answers[0]}）`);
});

test("DOM：打乱选项后，复盘态按锚点标出正确的那一行", async () => {
	const question = parse(FIVE);
	const host = await render(question, {
		shuffleOptions: true,
		shuffleSeed: 999,
		reviewOnly: true,
	});

	// 复盘态是为刷题窗口的重画准备的：选项换了位置，高亮仍必须落在锚点 c 上。
	const marked = [...host.querySelectorAll<HTMLElement>(".easy-quiz-card__option.is-answer")];
	assertEqual(marked.length, 1, `复盘应恰好标出一个正确选项（实际 ${marked.length} 个）`);
	assertEqual(marked[0]?.getAttribute("data-anchor"), "c", "标出的应是锚点为 c 的那一行");
	assertEqual(marked[0]?.textContent, "丙", "也就是「丙」那一行");
});
