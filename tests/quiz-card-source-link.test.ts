/**
 * 题卡回到原题的入口。
 *
 * 阅读视图里的题卡（数据块、`题目id` 引用）没有刷题窗口的导航栏，
 * 标题与右上角的铅笔必须都能打开源笔记，否则题卡是死路一条。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

const { document } = setupDom();

import { contentHash } from "../src/hash";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { renderQuizCard } from "../src/view";
import { QuizQuestion } from "../src/types";
import { assert, assertEqual, must, test } from "./harness";

const options: ParseOptions = { deps: { parseYaml: (s) => yaml.load(s), hash: contentHash } };

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
	"type: single",
	"answer: c",
	"```",
].join("\n");

function question(): QuizQuestion {
	return must(parseQuizFile(BANK, "题库/测试.md", options).questions[0], "未解析出题目");
}

async function render(host: HTMLElement, onOpenSource?: () => void): Promise<void> {
	await renderQuizCard(question(), {
		app: {} as never,
		service: {} as never,
		file: { path: "题库/测试.md" } as never,
		el: host,
		blankMarker: "highlight",
		onOpenSource,
	});
}

test("题卡：有回源入口时标题可点击、右上角有铅笔", async () => {
	const host = document.createElement("div");
	document.body.appendChild(host);
	let opened = 0;
	await render(host, () => {
		opened += 1;
	});

	const title = must(host.querySelector<HTMLElement>(".easy-quiz-card__title") ?? undefined, "题卡缺少标题");
	assert(title.classList.contains("is-link"), "标题应显示为链接");
	assertEqual(title.getAttribute("role"), "link", "标题的无障碍角色");
	title.click();
	assertEqual(opened, 1, "点标题应打开源笔记");

	const pencil = must(host.querySelector<HTMLElement>(".easy-quiz-card__edit") ?? undefined, "缺少铅笔按钮");
	pencil.click();
	assertEqual(opened, 2, "点铅笔也应打开源笔记");
});

test("题卡：没有回源入口时不显示链接样式与铅笔", async () => {
	const host = document.createElement("div");
	document.body.appendChild(host);
	await render(host);

	const title = must(host.querySelector<HTMLElement>(".easy-quiz-card__title") ?? undefined, "题卡缺少标题");
	assert(!title.classList.contains("is-link"), "没有入口时标题保持普通文本");
	assertEqual(host.querySelector(".easy-quiz-card__edit"), null, "没有入口时不显示铅笔");
});
