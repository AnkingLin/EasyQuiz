/**
 * 「题面只取最近一块」与 `question` / `distractors` 字段的测试。
 *
 * 这几条规则都直接决定用户看到什么，因此这里既验证解析结果，也在 jsdom 里
 * 渲染真实题卡确认呈现：
 *
 *   1. 自动标题模式（`headingMode: auto`）只把「自己这一段里有数据块」的标题当题；
 *   2. `question` 字段代替标题显示在卡片上；
 *   3. 题面取结构块上面那一段，附着在结构块里的文字算补充内容，更远的段不显示；
 *   4. `distractors` 只影响选择题呈现，不参与判分。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";
import { MarkdownRenderer } from "./obsidian-stub";

const { document } = setupDom();

import { contentHash } from "../src/hash";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { QuizQuestion } from "../src/types";
import { renderQuizCard } from "../src/view";
import { assert, assertEqual, must, test } from "./harness";

const deps = { parseYaml: (source: string): unknown => yaml.load(source), hash: contentHash };

function parse(source: string, extra: Partial<ParseOptions> = {}): QuizQuestion[] {
	return parseQuizFile(source, "题库/测试.md", { deps, ...extra }).questions;
}

const AUTO = [
	"## 传输层",
	"",
	"### TCP 握手",
	"",
	"- 一次 ^a",
	"- 两次 ^b",
	"- 三次 ^c",
	"",
	"```quiz",
	"id: t1",
	"type: single",
	"answer: c",
	"```",
	"",
	"## 应用层",
	"",
	"### HTTP 端口",
	"",
	"- 80 ^a",
	"- 443 ^b",
	"- 8080 ^c",
	"",
	"```quiz",
	"id: t2",
	"type: single",
	"answer: b",
	"```",
].join("\n");

test("自动标题模式：只把拥有数据块的最近标题当作题目", () => {
	const questions = parse(AUTO, { headingMode: "auto" });
	assertEqual(questions.length, 2, "两个分组标题下各有一道题");
	assertEqual(questions[0]?.id, "t1", "第一道题应是 t1");
	assertEqual(questions[1]?.id, "t2", "第二道题应是 t2");
	assert(questions.every((question) => question.ok), "两道题都应可作答");

	// 固定的 H2 模式只认 H2：两道题都会挂到分组标题下，标题因此变成"传输层"/"应用层"。
	const fixed = parse(AUTO, { headingMode: "level" });
	assertEqual(fixed.length, 2, "H2 模式下两个分组标题各成一题");
	assertEqual(fixed[0]?.title, "传输层", "固定层级时题目标题是分组标题");
	assertEqual(fixed[1]?.title, "应用层", "固定层级时第二题也挂在分组标题下");
});

test("question 字段：代替标题显示，但标题仍用于定位题目", () => {
	const source = [
		"## 甲",
		"",
		"- 选项一 ^a",
		"- 选项二 ^b",
		"",
		"```quiz",
		"id: q1",
		"type: single",
		"answer: a",
		"question: 屏幕上显示的题面",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	assertEqual(question.title, "甲", "标题应保持原样");
	assertEqual(question.displayTitle, "屏幕上显示的题面", "displayTitle 应取 question 字段");
});

test("question 字段不是字符串时给出提示并回退到标题", () => {
	const source = [
		"## 甲",
		"",
		"- 选项一 ^a",
		"- 选项二 ^b",
		"",
		"```quiz",
		"id: q1",
		"type: single",
		"answer: a",
		"question: [不是字符串]",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assertEqual(question?.displayTitle, "甲", "应回退到标题");
	assert(
		question?.warnings.some((warning) => warning.code === "field-invalid") === true,
		"应提示 field-invalid"
	);
});

const NEAREST = [
	"## 最近一块",
	"",
	"这是上一段的残留，不应出现在题面里。",
	"",
	"这是真正的题面。",
	"",
	"附着在选项上方的说明文字。",
	"- 选项一 ^a",
	"- 选项二 ^b",
	"",
	"```quiz",
	"id: nearest",
	"type: single",
	"answer: a",
	"```",
].join("\n");

test("题面只取最近的一段：贴着选项的文字不再带回空行后的段落", () => {
	const question = must(parse(NEAREST)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	// 最近的一段是「说明文字 + 选项列表」：说明文字已经是题面下面的补充内容，
	// 再上面隔着空行的一段属于更远的段落，不能再显示成题面。
	assertEqual(question.stemText, "", "贴着选项的说明文字存在时，题面不应再取上一段");
	assert(
		question.supplementText === "附着在选项上方的说明文字。",
		"贴着选项列表的文字应单独作为补充内容"
	);
	assert(!question.stemText?.includes("这是真正的题面。"), "空行后的段落不应进入题面");
	assert(!question.stemText?.includes("上一段的残留"), "更远的段不应进入题面");
	assertEqual(question.options.length, 2, "选项只取最近列表里的两条");
	assert(question.ok, "题目应可作答");
});

test("题面与补充内容在题卡里分成两个区域", async () => {
	const question = must(parse(NEAREST)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
	} as unknown as Parameters<typeof renderQuizCard>[1]);

	const supplement = host.querySelector(".easy-quiz-card__supplement");
	assert(supplement !== null, "有补充内容时应单独渲染一个区域");
	// 测试里的 MarkdownRenderer 只记录调用；按目标元素区分题面与补充内容。
	const rendered = MarkdownRenderer.calls.filter((call) => call.el !== supplement);
	const stemText = rendered.map((call) => call.source).join("\n");
	assert(!stemText.includes("这是真正的题面。"), "题面区不应渲染空行后的段落");
	assert(!stemText.includes("上一段的残留"), "题面区不应渲染更远的段");
	assert(
		MarkdownRenderer.calls.some(
			(call) => call.el === supplement && call.source.includes("附着在选项上方的说明文字。")
		),
		"补充内容区应渲染贴着的文字"
	);
});

const WITH_DISTRACTORS = [
	"## 干扰项",
	"",
	"- 甲 ^a",
	"- 乙 ^b",
	"- 丙 ^c",
	"",
	"```quiz",
	"id: dis",
	"type: single",
	"answer: a",
	"distractors:",
	"  count: 2",
	"  pool:",
	"    - 候选一",
	"    - 候选二",
	"    - 候选三",
	"    - 甲",
	"```",
].join("\n");

test("干扰项：解析数量与候选池，候选与作者选项重复时跳过", async () => {
	const question = must(parse(WITH_DISTRACTORS)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	assertEqual(question.distractorCount, 2, "应读出干扰项数量");
	assertEqual(question.distractorPool?.length, 4, "应读出候选池");

	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
	} as unknown as Parameters<typeof renderQuizCard>[1]);

	const rows = [...host.querySelectorAll<HTMLElement>(".easy-quiz-card__option")];
	assertEqual(rows.length, 5, "三个作者选项 + 两个干扰项");
	const texts = rows.map((row) => row.textContent ?? "");
	assertEqual(new Set(texts).size, 5, "选项文字不应重复（候选里的「甲」被跳过）");
	const extras = rows.filter((row) => (row.dataset["anchor"] ?? "").startsWith("~d"));
	assertEqual(extras.length, 2, "应插入两个带 ~d 锚点的干扰项");
});

test("干扰项不参与判分：正确答案锚点仍是作者写的那些", () => {
	const question = must(parse(WITH_DISTRACTORS)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	assertEqual(question.answer, "a", "正确答案仍是作者写的 a");
	// answerAnchors 记录的是选项锚点（用于在呈现里找正确项），干扰项不在其中。
	assertEqual(question.answerAnchors.length, 3, "answerAnchors 只包含作者选项的锚点");
});

test("非选择题写 distractors 时提示后忽略", () => {
	const source = [
		"## 填空",
		"",
		"最小长度是 ==20== 字节。",
		"",
		"```quiz",
		"id: b1",
		"type: blank",
		"distractors: 2",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(
		question?.warnings.some((warning) => warning.code === "field-invalid") === true,
		"应提示 field-invalid"
	);
});

test("复盘时用 lastAnswer 标出用户上次的选择", async () => {
	const question = must(parse(
		["## 复盘", "", "- 甲 ^a", "- 乙 ^b", "", "```quiz", "id: r1", "type: single", "answer: a", "```"].join(
			"\n"
		)
	)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
		reviewOnly: true,
		lastAnswer: { kind: "choice", anchors: ["b"] },
	} as unknown as Parameters<typeof renderQuizCard>[1]);

	const picked = host.querySelector<HTMLElement>(".easy-quiz-card__option.is-selected");
	assert(picked !== null, "选过的选项应带上 is-selected");
	assert(picked?.classList.contains("is-wrong") === true, "选错的项应标红");
	const answer = host.querySelector(".easy-quiz-card__option.is-answer");
	assert(answer !== null, "正确项仍应标出");
	const review = host.querySelector(".easy-quiz-card__review-answer-list");
	assert(review !== null, "复盘应列出「你的作答」");
	assert(review?.textContent?.includes("✗") === true, "选错的行应打叉");
});

test("复盘填空：写出用户填的值，并在不同时补上正确答案", async () => {
	const source = [
		"## 填空",
		"",
		"最小长度是 ==20== 字节。",
		"",
		"```quiz",
		"id: bl1",
		"type: blank",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
		reviewOnly: true,
		lastAnswer: { kind: "blank", values: ["18"] },
	} as unknown as Parameters<typeof renderQuizCard>[1]);

	// 测试用的 MarkdownRenderer 是空实现，题面里没有可替换的占位元素，
	// 复盘会走下方列表：列表里同样要写出用户填的值和正确答案。
	const answer = host.querySelector(".easy-quiz-card__blank-answer.is-user");
	assert(answer !== null, "复盘列表应展示用户填的值");
	assert(answer?.textContent?.includes("18") === true, "应显示用户填的 18");
	const expected = host.querySelector(".easy-quiz-card__blank-expected");
	assert(expected?.textContent?.includes("→ 20") === true, "填错时应补上正确答案");
});

test("干扰项：每次作答后重新抽取", async () => {	const question = must(parse(WITH_DISTRACTORS)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");

	const extrasOf = async (attempts: number): Promise<string> => {
		question.stats = { attempts, correct: 0, lastResult: null, lastAt: null };
		const host = document.createElement("div");
		document.body.appendChild(host);
		await renderQuizCard(question, {
			app: {},
			service: {},
			file: { path: "题库/测试.md" },
			el: host,
			blankMarker: "highlight",
			shuffleOptions: true,
			shuffleSeed: 7,
		} as unknown as Parameters<typeof renderQuizCard>[1]);
		return [...host.querySelectorAll<HTMLElement>(".easy-quiz-card__option")]
			.filter((row) => (row.dataset["anchor"] ?? "").startsWith("~d"))
			.map((row) => (row.textContent ?? "").trim())
			.sort()
			.join(",");
	};

	// 种子跟随 attempts：前几次作答应至少出现一种与首次不同的干扰项组合。
	const first = await extrasOf(0);
	const later = new Set<string>();
	for (let attempts = 1; attempts < 8; attempts++) later.add(await extrasOf(attempts));
	assert(first !== "", "首次作答也应有干扰项");
	assert([...later].some((extras) => extras !== first), "再次作答应重新抽取干扰项");
});

test("配对题：只把最近的一张表当结构，上面的表格属于题面内容", () => {
	const source = [
		"## 连续表格",
		"",
		"把左右两列连起来。",
		"",
		"| 左 | 右 |",
		"| --- | --- |",
		"| 甲 | 1 |",
		"",
		"| 左 | 右 |",
		"| --- | --- |",
		"| 乙 | 2 |",
		"",
		"```quiz",
		"type: match",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	assert(question.stemText?.startsWith("把左右两列连起来。") === true, "表格上面的题干仍应是题面");
	assert(question.stemText?.includes("| 甲 | 1 |") === true, "更上面的表格是题面内容，应保留");
	assertEqual(question.supplementText, "", "表格之间不应被当成补充内容");
	// 只识别最近的一张表：甲/1 不进入配对结构。
	assert(question.boardPairs?.length === 1, "只有最近一张表的数据行进入配对方");
	const cellTexts = (question.board ?? []).flatMap((column) => column.items.map((item) => item.text));
	assert(cellTexts.includes("乙"), "最近一张表应进入配对结构");
	assert(!cellTexts.includes("甲"), "更上面的表格不应进入配对结构");
	assert(question.ok, "题目应可作答");
});

test("配对题：表格段自带上文时，不再并入更远的一段", () => {
	const source = [
		"## 多段配对",
		"",
		"这是分组说明，不属于本题。",
		"",
		"把左右两列连起来。",
		"",
		"| 左 | 右 |",
		"| --- | --- |",
		"| 甲 | 1 |",
		"",
		"```quiz",
		"type: match",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assertEqual(question.stemText, "把左右两列连起来。", "题面应只取表格上面紧邻的一段");
	assert(!(question.stemText ?? "").includes("分组说明"), "更远的段不应进入题面");
	assert(question.ok, "题目应可作答");
});

test("选择题：题干里的表格属于题目内容，不能被丢掉", () => {
	// 表格和选项之间没有空行：表格和说明文字都附着在选项块里，应作为补充内容显示。
	const attached = [
		"## 协议端口",
		"",
		"根据下表作答。",
		"",
		"| 协议 | 端口 |",
		"| --- | --- |",
		"| HTTP | 80 |",
		"",
		"- 80 ^a",
		"- 443 ^b",
		"",
		"```quiz",
		"type: single",
		"answer: a",
		"```",
	].join("\n");
	const question = must(parse(attached)[0], "应解析出题目");
	assert(question.ok, "题目应可作答");
	assertEqual(question.options.length, 2, "选项应正常解析");
	assert((question.stemText ?? "").includes("| HTTP | 80 |"), "题干里的表格应保留在题面中");
	assert((question.stemText ?? "").includes("根据下表作答。"), "表格上面的文字仍是题面");

	// 表格紧贴选项行（同一段）时也要保留表格，而不是当成结构行丢掉。
	const glued = [
		"## 贴在一起的表格",
		"",
		"| 协议 | 端口 |",
		"| --- | --- |",
		"| HTTP | 80 |",
		"- 80 ^a",
		"- 443 ^b",
		"",
		"```quiz",
		"type: single",
		"answer: a",
		"```",
	].join("\n");
	const gluedQuestion = must(parse(glued)[0], "应解析出题目");
	assertEqual(gluedQuestion.stemText, "", "表格直接贴着选项、上方没有题面时，题面为空");
	assert((gluedQuestion.supplementText ?? "").includes("| HTTP | 80 |"), "附着的表格应作为补充内容保留");
});

test("填空题：表格上方的普通段也属于题面，遇到普通空行才停下", () => {
	const source = [
		"## 表上空行",
		"",
		"更远的说明，不属于本题。",
		"",
		"根据下表填空。",
		"",
		"| 项目 | 值 |",
		"| --- | --- |",
		"| 甲 | ==1== |",
		"",
		"```quiz",
		"type: blank",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	assert(
		(question.stemText ?? "").includes("根据下表填空。"),
		"表格上面的普通段应取进题面"
	);
	assert((question.stemText ?? "").includes("| 项目 | 值 |"), "表格本身也是题目内容");
	assert(!(question.stemText ?? "").includes("更远的说明"), "再往上的普通空行应停止取段");
	assertEqual(question.blanks.length, 1, "表格里的空位应被识别");
	assert(question.ok, "题目应可作答");
});

test("补充内容里的表格：渲染前补上表格需要的空行", async () => {
	// 说明文字和表格贴在一起，又一起贴着选项列表：它们都算补充内容。
	const source = [
		"## 表格补充",
		"",
		"说明文字。",
		"| 协议 | 端口 |",
		"| --- | --- |",
		"| HTTP | 80 |",
		"- 80 ^a",
		"- 443 ^b",
		"",
		"```quiz",
		"type: single",
		"answer: a",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
	} as unknown as Parameters<typeof renderQuizCard>[1]);

	const supplement = host.querySelector(".easy-quiz-card__supplement");
	assert(supplement !== null, "应渲染补充内容区域");
	const rendered = MarkdownRenderer.calls.find((call) => call.el === supplement);
	if (rendered === undefined) throw new Error("补充内容应走 Markdown 渲染");
	assert(
		rendered.source.includes("说明文字。\n\n| 协议 | 端口 |"),
		`表格前应有空行（实际：${JSON.stringify(rendered.source)}）`
	);
});

test("问答题：callout 与上面的段一起显示，表格的强制空行同样越过", () => {
	const source = [
		"## 问答一",
		"",
		"阅读下表。",
		"",
		"| 项目 | 值 |",
		"| --- | --- |",
		"| 甲 | 1 |",
		"",
		"请说明甲的作用。",
		"",
		"> [!note] 参考答案",
		"> 甲的值是 1。",
		"",
		"```quiz",
		"type: essay",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	const stem = question.stemText ?? "";
	assert(stem.includes("阅读下表。"), "表格上方的普通段属于题面");
	assert(stem.includes("| 甲 | 1 |"), "表格本身属于题目内容");
	assert(stem.includes("请说明甲的作用。"), "callout 上面紧邻的一段属于题面");
	assert(stem.includes("参考答案"), "参考答案 callout 应保留在题面里");
	assertEqual(question.supplementText, "", "问答题不应产生补充内容");
	assert(question.ok, "题目应可作答");
});

test("问答题：callout 上面的普通段从第二段起就停下", () => {
	const source = [
		"## 问答二",
		"",
		"更远的说明，不属于本题。",
		"",
		"题干一段。",
		"",
		"> 参考答案。",
		"",
		"```quiz",
		"type: essay",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	const stem = question.stemText ?? "";
	assert(stem.includes("题干一段。"), "紧邻 callout 的一段属于题面");
	assert(stem.includes("参考答案。"), "callout 应保留");
	assert(!stem.includes("更远的说明"), "普通空行之后的更远段不应取进题面");
	assert(question.ok, "题目应可作答");
});

test("题面与补充内容容器带 markdown-rendered，表格使用主题样式", async () => {
	const source = [
		"## 样式",
		"",
		"说明文字。",
		"| 协议 | 端口 |",
		"| --- | --- |",
		"| HTTP | 80 |",
		"- 80 ^a",
		"- 443 ^b",
		"",
		"```quiz",
		"type: single",
		"answer: a",
		"```",
	].join("\n");
	const question = must(parse(source)[0], "应解析出题目");
	assert(question !== undefined, "应解析出题目");
	const host = document.createElement("div");
	document.body.appendChild(host);
	await renderQuizCard(question, {
		app: {},
		service: {},
		file: { path: "题库/测试.md" },
		el: host,
		blankMarker: "highlight",
	} as unknown as Parameters<typeof renderQuizCard>[1]);
	const body = host.querySelector(".easy-quiz-card__body");
	const supplement = host.querySelector(".easy-quiz-card__supplement");
	assert(body !== null, "应渲染题面容器");
	assert(supplement !== null, "应渲染补充内容容器");
	assert(body?.classList.contains("markdown-rendered") === true, "题面容器应带 markdown-rendered");
	assert(
		supplement?.classList.contains("markdown-rendered") === true,
		"补充内容容器应带 markdown-rendered，表格才会用上主题样式"
	);
});
