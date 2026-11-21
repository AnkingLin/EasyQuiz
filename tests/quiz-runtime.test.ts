/**
 * 写回编排测试（QuizService）。
 *
 * 之前这一层只有纯函数的写回测试，`Vault.process` 的调用编排（重新解析、定位、
 * 写回失败、并发提交、行尾保留）完全没有被驱动。这里用一个最小的内存 Vault
 * 模拟原子读改写，并显式注入与 Obsidian 一致的解析依赖。
 */

import * as yaml from "js-yaml";
import type { App } from "obsidian";
import { TFile } from "obsidian";
import { contentHash } from "../src/hash";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { DEFAULT_SETTINGS, QuizService, RuntimeSettings } from "../src/runtime";
import { assert, assertEqual, must, test } from "./harness";

const deps = { parseYaml: (source: string): unknown => yaml.load(source), hash: contentHash };

const parseOptions: ParseOptions = { deps };

interface FakeVault {
	content: () => string;
	file: TFile;
	app: App;
}

/** 一个最小但行为正确的 Vault：process 串行执行，写入后内容才可见。 */
function makeVault(initial: string, cache: unknown = { frontmatter: { quiz: true } }): FakeVault {
	const file = new TFile();
	file.path = "题库/测试.md";
	let content = initial;
	let queue: Promise<unknown> = Promise.resolve();

	const vault = {
		cachedRead: async (): Promise<string> => content,
		process: (_file: TFile, fn: (data: string) => string): Promise<string> => {
			const task = queue.then(() => {
				const next = fn(content);
				if (next !== content) content = next;
				return next;
			});
			queue = task;
			return task;
		},
		getAbstractFileByPath: (path: string): TFile | null => (path === file.path ? file : null),
		getMarkdownFiles: (): TFile[] => [file],
	};
	const metadataCache = {
		getFileCache: () => cache,
	};
	const app = { vault, metadataCache } as unknown as App;
	return { content: () => content, file, app };
}

function serviceFor(vault: FakeVault, settings: Partial<RuntimeSettings> = {}): QuizService {
	return new QuizService(
		vault.app,
		{ ...DEFAULT_SETTINGS, ...settings },
		deps
	);
}

const bank = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 握手",
	"",
	"- 一次 ^a",
	"- 三次 ^c",
	"",
	"```quiz",
	"type: single",
	"answer: c",
	"```",
].join("\n");

function parseContent(content: string, options: ParseOptions = parseOptions) {
	return parseQuizFile(content, "题库/测试.md", options);
}

test("写回：判分后写入 stats/history，时间戳可读回", async () => {
	const vault = makeVault(bank);
	const service = serviceFor(vault);
	const result = await service.submit(vault.file, "握手", { kind: "choice", anchors: ["c"] });
	assert(result !== null, "应返回判分结果");
	assertEqual(result!.correct, true, "选对应判对");
	assertEqual(result!.written, true, "应写入笔记");

	const parsed = parseContent(vault.content());
	const question = must(parsed.questions[0], "应能解析回题目");
	assertEqual(question.stats.attempts, 1, "attempts");
	assertEqual(question.stats.correct, 1, "correct");
	assert(typeof question.stats.lastAt === "string", "lastAt 应是字符串");
	assertEqual(question.history.length, 1, "history 条数");
	assertEqual(typeof question.history[0]?.at, "string", "history.at 应是字符串");
});

test("写回：关闭写回时只判分，不改文件", async () => {
	const vault = makeVault(bank);
	const service = serviceFor(vault, { writeBackEnabled: false });
	const result = await service.submit(vault.file, "握手", { kind: "choice", anchors: ["c"] });
	assertEqual(result!.written, undefined, "未尝试写回时 written 应为 undefined");
	assertEqual(vault.content(), bank, "文件不应变化");
});

test("写回：非题库文件识别与写回使用同一套规则", async () => {
	// 只有 #quiz 标签、没有 quiz: true 的文件也能写回（重解析不依赖识别结果）。
	const vault = makeVault(bank, { frontmatter: {}, tags: [{ tag: "#quiz" }] });
	const service = serviceFor(vault);
	assertEqual(service.isQuizFile(vault.file), true, "应被 tag 识别为题库");
	const result = await service.submit(vault.file, "握手", { kind: "choice", anchors: ["a"] });
	assertEqual(result!.written, true, "tag 题库也应能写回");
	assert(parseContent(vault.content()).questions[0]!.stats.attempts === 1, "应写入 stats");
});

test("写回：并发提交不会丢失次数", async () => {
	const vault = makeVault(bank);
	const service = serviceFor(vault);
	await Promise.all([
		service.submit(vault.file, "握手", { kind: "choice", anchors: ["c"] }),
		service.submit(vault.file, "握手", { kind: "choice", anchors: ["a"] }),
	]);
	const question = must(parseContent(vault.content()).questions[0], "应能解析回题目");
	assertEqual(question.stats.attempts, 2, "两次提交都应累计");
	assertEqual(question.stats.correct, 1, "只有一次答对");
});

test("写回：CRLF 笔记提交后仍保持 CRLF", async () => {
	const vault = makeVault(bank.replace(/\n/g, "\r\n"));
	const service = serviceFor(vault);
	await service.submit(vault.file, "握手", { kind: "choice", anchors: ["c"] });
	const content = vault.content();
	assert(content.includes("\r\n"), "应保留 CRLF");
	assert(!/[^\r]\n/.test(content), "不应出现裸 LF");
});

test("清除记录：清掉 stats/history，保留其它字段", async () => {
	const vault = makeVault(bank);
	const service = serviceFor(vault);
	await service.submit(vault.file, "握手", { kind: "choice", anchors: ["c"] });
	const cleared = await service.clearQuestionRecords(vault.file, "握手");
	assertEqual(cleared, true, "应清除成功");
	const question = must(parseContent(vault.content()).questions[0], "应能解析回题目");
	assertEqual(question.stats.attempts, 0, "attempts 应归零");
	assertEqual(question.history.length, 0, "history 应清空");
	assert(vault.content().includes("answer: c"), "答案字段应保留");
});

test("写回：process 回调期间题目消失时返回 written=false", async () => {
	const vault = makeVault(bank);
	const service = serviceFor(vault);
	// 模拟另一个窗口在写回读取到最新内容之前把标题改了。
	const realVault = (vault.app as unknown as { vault: { process: unknown } }).vault;
	realVault.process = (_file: TFile, fn: (data: string) => string): Promise<string> =>
		Promise.resolve(fn(bank.replace("## 握手", "## 改名")));
	const result = await service.submit(vault.file, "握手", { kind: "choice", anchors: ["c"] });
	assert(result !== null, "题目存在时应判分");
	assertEqual(result!.correct, true, "仍应判分");
	assertEqual(result!.written, false, "目标题目消失时应报告未写入");
});
