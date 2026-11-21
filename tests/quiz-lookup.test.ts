/**
 * 数据块 → 题目映射测试。
 *
 * 阅读视图拿到的只有行号区间与源码；这条映射决定渲染的是哪一道题，
 * 因此单独覆盖「行号命中」「源码兜底」「都不命中」三种情况。
 */

import * as yaml from "js-yaml";
import { findQuestion } from "../src/quiz-lookup";
import { contentHash } from "../src/hash";
import { parseQuizFile } from "../src/parser";
import { assert, assertEqual, must, test } from "./harness";

const source = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 甲",
	"",
	"- 一 ^a",
	"- 二 ^b",
	"",
	"```quiz",
	"type: single",
	"answer: a",
	"```",
	"",
	"## 乙",
	"",
	"```quiz",
	"type: essay",
	"```",
].join("\n");

const parsed = parseQuizFile(source, "题库/测试.md", {
	deps: { parseYaml: (text) => yaml.load(text), hash: contentHash },
});

test("数据块映射：行号区间命中时取对应的题目", () => {
	const question = findQuestion(parsed, { lineStart: 0, lineEnd: 20 }, "```quiz\ntype: essay\n```");
	assertEqual(question?.title, "甲", "应取区间内第一个 blockLine");
});

test("数据块映射：行号对不上时按源码兜底", () => {
	const second = must(parsed.questions[1], "应有第二题");
	const question = findQuestion(parsed, null, second.blockSource ?? "");
	assertEqual(question?.title, "乙", "应命中源码相同的题目");
});

test("数据块映射：行号与源码都对不上时返回 null", () => {
	assertEqual(findQuestion(parsed, { lineStart: 0, lineEnd: 1 }, "```quiz\ntype: none\n```"), null, "应返回 null");
	assert(findQuestion(parsed, null, "") === null, "空源码不应误命中");
});
