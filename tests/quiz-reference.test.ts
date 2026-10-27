/**
 * `题目id` 引用的纯逻辑测试。
 *
 * 规则与嵌入一致：只有整段内联代码就是 id、且能唯一定位到一道可作答的题时才接管，
 * 其余情况必须保持原样——普通代码片段很多，误伤的代价比少渲染一次高得多。
 */

import { JSDOM } from "jsdom";
import * as yaml from "js-yaml";
import { contentHash } from "../src/hash";
import { parseQuizFile } from "../src/parser";
import { buildReferenceIndex, parseReferenceId, pickReference } from "../src/reference";
import { assertEqual, test } from "./harness";

function must<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

const deps = { parseYaml: (source: string) => yaml.load(source), hash: contentHash };

const BANK = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 三次握手",
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
	"## 应用层协议",
	"",
	"HTTP 默认端口是？",
	"",
	"- 80 ^a",
	"- 443 ^b",
	"",
	"```quiz",
	"id: app-layer",
	"type: single",
	"answer: a",
	"```",
	"",
].join("\n");

const OTHER = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 重复的题",
	"",
	"哪一个是 1+1？",
	"",
	"- 2 ^a",
	"- 3 ^b",
	"",
	"```quiz",
	"id: tcp-handshake",
	"type: single",
	"answer: a",
	"```",
	"",
].join("\n");

function banks() {
	return [
		{ path: "题库/网络.md", questions: parseQuizFile(BANK, "题库/网络.md", { deps }).questions },
		{ path: "题库/杂项.md", questions: parseQuizFile(OTHER, "题库/杂项.md", { deps }).questions },
	];
}

test("引用：只有整段就是 id 的内联代码才算引用", () => {
	assertEqual(parseReferenceId("tcp-handshake"), "tcp-handshake", "普通 id 原样返回");
	assertEqual(parseReferenceId(""), null, "空代码不是引用");
	assertEqual(parseReferenceId("  tcp-handshake  "), null, "带空白的代码不是引用");
	assertEqual(parseReferenceId("two words"), null, "含空白的代码不是引用");
	assertEqual(parseReferenceId("a\nb"), null, "含换行的代码不是引用");
});

test("引用：索引按 id 归并，重名的题全部保留", () => {
	const index = buildReferenceIndex(banks());
	assertEqual(index.get("app-layer")?.length, 1, "唯一的 id 只有一条");
	assertEqual(index.get("tcp-handshake")?.length, 2, "两份题库里的同名 id 都保留");
});

test("引用：优先当前笔记里的题", () => {
	const index = buildReferenceIndex(banks());
	const hits = must(index.get("tcp-handshake"), "应命中重名的 id");
	const local = pickReference(hits, "题库/杂项.md");
	assertEqual(local?.path, "题库/杂项.md", "当前笔记里的那道题优先");
});

test("引用：跨题库唯一时才解析，重名保持原样", () => {
	const index = buildReferenceIndex(banks());
	const unique = must(index.get("app-layer"), "应命中唯一的 id");
	assertEqual(pickReference(unique, "随便/笔记.md")?.path, "题库/网络.md", "唯一的题可以直接引用");

	const duplicated = must(index.get("tcp-handshake"), "应命中重名的 id");
	assertEqual(pickReference(duplicated, "随便/笔记.md"), null, "无法唯一确定时不接管");
});

test("引用：同一个文件里重复的 id 也不接管", () => {
	const index = buildReferenceIndex([
		{
			path: "题库/重复.md",
			questions: [
				...parseQuizFile(BANK, "题库/重复.md", { deps }).questions,
				...parseQuizFile(OTHER, "题库/重复.md", { deps }).questions,
			],
		},
	]);
	const hits = must(index.get("tcp-handshake"), "应命中重名的 id");
	assertEqual(pickReference(hits, "题库/重复.md"), null, "同文件重名同样无法确定");
});

/** 保证 jsdom 在 node 环境里可用（其他 DOM 测试也依赖它，这里顺带固定版本行为）。 */
test("引用：jsdom 可用", () => {
	const dom = new JSDOM("<p><code>tcp-handshake</code></p>");
	assertEqual(dom.window.document.querySelector("code")?.textContent, "tcp-handshake", "读取代码文本");
});
