/**
 * 题目嵌入的纯逻辑测试。
 *
 * 这里覆盖「该不该接管一个 embed」的判定与「接管后找回哪道题」的查找：
 * 两件事都必须确定、可解释，因为它们决定了插件会不会插手用户正常的
 * `![[笔记#小节]]`——误判的代价是把别人的内容吃掉。
 */

import * as yaml from "js-yaml";
import { JSDOM } from "jsdom";
import { contentHash } from "../src/hash";
import {
	claimEmbedHost,
	findEmbeddedQuestion,
	isInsideQuizCard,
	looksLikeQuestionRef,
	matchesQuestionHeading,
	normalizeHeadingKey,
	splitEmbedSrc,
} from "../src/embed";
import { parseQuizFile } from "../src/parser";
import { QuizQuestion } from "../src/types";
import { assert, assertEqual, test } from "./harness";

const options = { deps: { parseYaml: (source: string) => yaml.load(source), hash: contentHash } };

/** 一道带知识点链接的单选题。 */
const BANK = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 三次握手 ^[[[计算机网络/传输层#TCP 三次握手]]]",
	"",
	"建立连接需要几次握手？",
	"",
	"- 一次 ^a",
	"- 三次 ^c",
	"",
	"```quiz",
	"id: tcp-handshake",
	"type: single",
	"answer: c",
	"```",
	"",
	"## 三次握手简介 ^[[[计算机网络/传输层#握手概述]]]",
	"",
	"- 甲 ^a",
	"- 乙 ^b",
	"",
	"```quiz",
	"type: single",
	"answer: a",
	"```",
	"",
].join("\n");

function bank() {
	return parseQuizFile(BANK, "题库/网络.md", options);
}

/**
 * 断言查找一定命中。
 *
 * `must` 只去掉 `undefined`（配合 `noUncheckedIndexedAccess`），而这里的返回值是
 * `QuizQuestion | null`，因此需要一个把 null 也收掉的小助手。
 */
function found(question: QuizQuestion | null, message: string): QuizQuestion {
	if (question === null) throw new Error(message);
	return question;
}

// ---------------------------------------------------------------------------
// src 拆分
// ---------------------------------------------------------------------------

test("嵌入：src 拆成路径与子路径", () => {
	assertEqual(splitEmbedSrc("题库/网络#三次握手").path, "题库/网络", "路径");
	assertEqual(splitEmbedSrc("题库/网络#三次握手").subpath, "三次握手", "子路径");
	assertEqual(splitEmbedSrc("题库/网络").subpath, "", "没有子路径时为空串");
	assertEqual(splitEmbedSrc("  题库/网络#三次握手  ").path, "题库/网络", "两端空白应去掉");
});

/**
 * 与 Obsidian 自己的 `wD` 保持一致：**按第一个 `#` 切分**。
 * 因此路径里不能含 `#`（`![[语言/C# 入门#历史]]` 的目标会被解析成 `语言/C`）——
 * 这是 Obsidian 的既定解析方式，插件跟随它，而不是自己另立一套规则。
 */
test("嵌入：按第一个 # 切分（与 Obsidian 的解析一致）", () => {
	const target = splitEmbedSrc("语言/C# 入门");
	assertEqual(target.path, "语言/C", "第一个 # 就是分隔符");
	assertEqual(target.subpath, "入门", "其余部分算子路径");
});

// ---------------------------------------------------------------------------
// 该不该接管
// ---------------------------------------------------------------------------

test("嵌入：空子路径、块引用、脚注引用都不当作题目引用", () => {
	assertEqual(looksLikeQuestionRef(""), false, "整份文件的嵌入不该接管");
	assertEqual(looksLikeQuestionRef("^block-id"), false, "块引用不是题目");
	assertEqual(looksLikeQuestionRef("[^1]"), false, "脚注引用不是题目");
	assertEqual(looksLikeQuestionRef("三次握手"), true, "标题引用才是");
});

test("嵌入：标题归一化会先摘掉末尾的知识点链接", () => {
	assertEqual(
		normalizeHeadingKey("三次握手 ^[[[计算机网络/传输层#TCP 三次握手]]]"),
		"三次握手",
		"知识点链接不应参与比对"
	);
	assertEqual(normalizeHeadingKey("三次握手"), "三次握手", "没有链接时原样");
	assertEqual(normalizeHeadingKey("TCP 三次握手"), "tcp 三次握手", "忽略大小写");
});

test("嵌入：标题原文形态（带知识点链接）能命中同层级标题", () => {
	const headings = [
		{ heading: "三次握手 ^[[[计算机网络/传输层#TCP 三次握手]]]", level: 2 },
		{ heading: "三次握手简介 ^[[[计算机网络/传输层#握手概述]]]", level: 2 },
	];
	assertEqual(matchesQuestionHeading("三次握手", headings, [2, 2]), true, "应命中带链接的题面标题");
	assertEqual(matchesQuestionHeading("三次握手简介", headings, [2, 2]), true, "另一道题也应命中");
	assertEqual(matchesQuestionHeading("握手", headings, [2, 2]), false, "不完整的标题不该命中");
});

/**
 * `metadataCache` 里的标题可能是渲染后的纯文本：知识点链接被摊平成文字接在标题后面。
 * 这时必须按「整词前缀」比对，否则 `三次握手` 会把 `三次握手简介` 也一起命中。
 */
test("嵌入：标题纯文本形态按整词前缀命中，且不误伤更长的标题", () => {
	const headings = [
		{ heading: "三次握手 计算机网络 传输层 TCP 三次握手", level: 2 },
		{ heading: "三次握手简介 计算机网络 传输层 握手概述", level: 2 },
	];
	assertEqual(matchesQuestionHeading("三次握手", headings, [2, 2]), true, "前缀命中带链接的那道题");
	assertEqual(
		matchesQuestionHeading("三次握手简介", headings, [2, 2]),
		true,
		"更长的标题按自己的子路径也应命中"
	);
	const onlyShort = [{ heading: "三次握手 计算机网络 传输层 TCP 三次握手", level: 2 }];
	assertEqual(
		matchesQuestionHeading("三次握手简介", onlyShort, [2, 2]),
		false,
		"另一个标题不该被前缀规则误命中"
	);
});

test("嵌入：题面层级之外的标题不算题目", () => {
	const headings = [{ heading: "背景", level: 3 }];
	assertEqual(matchesQuestionHeading("背景", headings, [2, 2]), false, "H3 子标题不是题目");
	assertEqual(matchesQuestionHeading("背景", headings, [2, 4]), true, "层级区间放宽后才是");
});

test("嵌入：子路径为空时永不命中（避免把整份文件当题目）", () => {
	const headings = [{ heading: "三次握手", level: 2 }];
	assertEqual(matchesQuestionHeading("", headings, [2, 2]), false, "空子路径不该命中");
});

// ---------------------------------------------------------------------------
// 找回题目
// ---------------------------------------------------------------------------

test("嵌入：按题面标题找回题目，且不把知识点链接算进标题", () => {
	const question = found(findEmbeddedQuestion(bank(), "三次握手"), "应找回「三次握手」");
	assertEqual(question.id, "tcp-handshake", "找回的应是那道题");
	assertEqual(question.title, "三次握手", "题面标题已去掉知识点链接");
});

test("嵌入：更长的标题不会被更短的名字抢走", () => {
	const parsed = bank();
	const short = found(findEmbeddedQuestion(parsed, "三次握手"), "应找回短标题的题");
	const long = found(findEmbeddedQuestion(parsed, "三次握手简介"), "应找回长标题的题");
	assert(short !== long, "两个子路径应各自命中不同的题");
	assertEqual(short.title, "三次握手", "短标题命中自身");
	assertEqual(long.title, "三次握手简介", "长标题命中自身");
});

test("嵌入：找不到题目时返回 null，而不是猜一道", () => {
	assertEqual(findEmbeddedQuestion(bank(), "并不存在的题"), null, "不存在应返回 null");
	assertEqual(findEmbeddedQuestion(bank(), ""), null, "空子路径应返回 null");
	assertEqual(findEmbeddedQuestion(bank(), "^block"), null, "块引用应返回 null");
});

/**
 * 普通笔记的防护不在查找层，而在**接管判定**那一层：`main.ts` 先要求
 * `QuizService.isQuizFile(目标文件)` 成立，普通笔记根本走不到查找。
 *
 * 这一点值得钉住，因为解析器本身并不看「是不是题库文件」——它按标题切题，
 * 任何 H2 都会产出一道题（缺数据块时降级）。如果哪天接管判定漏掉了题库检查，
 * 用户的普通笔记就会被插件接管，这里记录的正是那道防线。
 */
test("嵌入：普通笔记的 H2 也会被解析成降级题，因此接管必须先要求「是题库文件」", () => {
	const plain = parseQuizFile("## 三次握手\n\n普通笔记正文。\n", "笔记/普通.md", options);
	assertEqual(plain.fileIsQuiz, false, "普通笔记不是题库文件");
	assertEqual(plain.questions.length, 1, "解析器只看标题，因此仍会切出一道题");
	assertEqual(plain.questions[0]?.ok, false, "缺数据块时应降级，不能作答");
	// 查找层不负责拦截普通笔记——那道防线是调用方的 isQuizFile 判定。
	assertEqual(findEmbeddedQuestion(plain, "三次握手")?.ok, false, "找回的是一道降级题");
});

test("嵌入：没有匹配标题的文件里什么都找不到", () => {
	// 选择题至少要两个选项，否则解析器会按结构不符降级。
	const source = "## 另一道题\n\n- 甲 ^a\n- 乙 ^b\n\n```quiz\ntype: single\nanswer: a\n```\n";
	const other = parseQuizFile(source, "题库/别的.md", options);
	assertEqual(findEmbeddedQuestion(other, "并不存在的题"), null, "标题对不上就应返回 null");
	assertEqual(found(findEmbeddedQuestion(other, "另一道题"), "应有题目").ok, true, "对得上的题可作答");
});

// ---------------------------------------------------------------------------
// 认领容器
// ---------------------------------------------------------------------------

/**
 * 替换边界曾经写错：早先的实现在替换前先 `closest(".markdown-embed")`，
 * 想连 Obsidian 的嵌入外壳一起换掉。但 Obsidian 把 `markdown-embed` 加在
 * `.internal-embed` **这个同一个容器**上，而且是在本插件的后处理器**之后**；
 * 因此认领那一刻祖先里唯一的 `.markdown-embed` 只可能是**外层**的另一个嵌入——
 * 一道题里嵌了另一道题时，外层内容会被整块删掉。
 *
 * 这里用嵌套结构把这个边界钉住。
 */
test("嵌入：认领容器时就地改造，不吞掉外层的嵌入内容", () => {
	const document = new JSDOM("<!doctype html><html><body></body></html>").window.document;
	// 外层嵌入：Obsidian 会把 markdown-embed 加在 internal-embed 自身上。
	const outer = document.createElement("div");
	outer.className = "internal-embed markdown-embed";
	outer.setAttribute("src", "笔记/外层#小节");
	const outerBody = document.createElement("div");
	outerBody.className = "markdown-embed-content";
	outerBody.textContent = "外层内容";
	outer.appendChild(outerBody);

	// 内层嵌入（外层内容里的一个题卡嵌入）。
	const inner = document.createElement("div");
	inner.className = "internal-embed";
	inner.setAttribute("src", "题库/网络#三次握手");
	// Obsidian 可能已经放进去的落点内容，认领时应被清掉。
	const stale = document.createElement("div");
	stale.className = "markdown-embed-title";
	stale.textContent = "旧标题";
	inner.appendChild(stale);
	outerBody.appendChild(inner);

	const host = claimEmbedHost(inner);

	assertEqual(host, inner, "应当就地改造传入的元素，而不是新建一个");
	assert(host.classList.contains("easy-quiz-embed"), "应带上题卡容器的类名");
	assertEqual(
		host.classList.contains("internal-embed"),
		false,
		"必须摘掉 internal-embed，否则 Obsidian 随后仍会把它当嵌入载入"
	);
	assertEqual(host.textContent, "", "认领时应清掉 Obsidian 事先放进来的落点内容");
	// 关键：外层容器必须还在，而且仍然包含外层文字。
	assertEqual(inner.parentElement, outerBody, "元素应留在原位（外层内容里）");
	assertEqual(outerBody.textContent?.includes("外层内容"), true, "外层内容不能被删掉");
	assertEqual(outer.getAttribute("src"), "笔记/外层#小节", "外层元素应原样保留");
});

/**
 * 递归必须被掐断：题卡渲染题面时会调用 `MarkdownRenderer.render`，而它会把后处理器
 * 再跑一遍。题面里如果又出现 `![[题库#题目]]`，不拦住就会无限渲染下去
 * （一道引用自己的题足以把 Obsidian 卡死）。判据是 DOM 位置，因此不依赖渲染顺序。
 */
test("嵌入：已经在题卡里的嵌入不再被接管（掐断递归）", () => {
	const document = new JSDOM("<!doctype html><html><body></body></html>").window.document;

	// 笔记正文里的 embed：不在任何题卡里，应当被接管。
	const inNote = document.createElement("div");
	inNote.className = "internal-embed";
	document.body.appendChild(inNote);
	assertEqual(isInsideQuizCard(inNote), false, "正文里的 embed 可以接管");

	// 题卡题面里的 embed：位于 easy-quiz-embed 之内，不再接管。
	const host = document.createElement("div");
	host.className = "easy-quiz-embed";
	const card = document.createElement("div");
	card.className = "easy-quiz-card";
	const body = document.createElement("div");
	body.className = "easy-quiz-card__body";
	const inCard = document.createElement("div");
	inCard.className = "internal-embed";
	body.appendChild(inCard);
	card.appendChild(body);
	host.appendChild(card);
	document.body.appendChild(host);

	assertEqual(isInsideQuizCard(inCard), true, "题卡里的 embed 不应再被接管");
	assertEqual(isInsideQuizCard(card), true, "题卡元素本身也在容器之内");
	assertEqual(isInsideQuizCard(host), true, "容器自身也算「里面」");
});
