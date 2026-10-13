/**
 * 刷题窗口的 DOM 测试（jsdom）。
 *
 * 窗口本身只是"把纯逻辑画出来"的一层界面，因此这里不验证抽题算法（那是
 * `quiz-session.test.ts` 的事），而是按用户的操作顺序走一遍三个页面：
 * 列表 → 勾选/进入设置 → 改模式与题型 → 开始刷题 → 提交 → 下一题 → 成绩单，
 * 确认每一步都点得到、页面真的换了、并且作答确实交给了 QuizService。
 *
 * 题卡内部（选项、连线、空位）由其它 DOM 测试覆盖，这里用 `cardRenderer` 替身
 * 顶掉，只观察窗口把哪道题、哪种上下文交给了渲染层。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

const { window: testWindow } = setupDom();

import { parseQuizFile } from "../src/parser";
import { contentHash } from "../src/hash";
import { EasyQuizHost, PracticeView } from "../src/practice-view";
import { CardContext } from "../src/view";
import { GradeResult } from "../src/grade";
import { QuizQuestion } from "../src/types";
import { assert, assertEqual, at, must, test } from "./harness";
import { Setting } from "./obsidian-stub";

// ---------------------------------------------------------------------------
// 夹具
// ---------------------------------------------------------------------------

const options = { deps: { parseYaml: (source: string) => yaml.load(source), hash: contentHash } };

/** 一个题库文件：两道单选 + 一道填空。 */
const BANK_A = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 单选题甲",
	"",
	"- 选项一 ^a",
	"- 选项二 ^b",
	"",
	"```quiz",
	"id: a1",
	"type: single",
	"answer: a",
	"```",
	"",
	"## 单选题乙",
	"",
	"- 选项一 ^a",
	"- 选项二 ^b",
	"",
	"```quiz",
	"id: a2",
	"type: single",
	"answer: b",
	"```",
	"",
	"## 填空题甲",
	"",
	"最小长度是 ==20== 字节。",
	"",
	"```quiz",
	"id: a3",
	"type: blank",
	"```",
].join("\n");

/** 第二份文件放在子目录里，用来验证列表按路径分组。 */
const BANK_B = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 简答题甲",
	"",
	"随便写点什么。",
	"",
	"```quiz",
	"id: b1",
	"type: essay",
	"```",
].join("\n");

interface FakeFile {
	path: string;
	basename: string;
	stat: { mtime: number };
}

function fakeFile(path: string, mtime = 0): FakeFile {
	const base = path.split("/").pop() ?? path;
	return { path, basename: base.replace(/\.md$/, ""), stat: { mtime } };
}

/** 一道题上一次答错了：用来验证「只刷错题」。 */
const WRONG_STATS = "stats: { attempts: 3, correct: 1, lastResult: wrong }";

interface Harness {
	view: PracticeView;
	/** 每次题卡渲染的参数。 */
	renders: { question: QuizQuestion; ctx: CardContext }[];
	/** 传给 QuizService.submit 的调用。 */
	submitted: { path: string; id: string }[];
	/** 可替换的替身服务：个别用例会改写这几个方法。 */
	service: {
		listQuizFiles: () => FakeFile[];
		parseFile: (file: FakeFile) => Promise<unknown>;
		fileAtPath: (path: string) => FakeFile | null;
		submit: (file: FakeFile, id: string) => Promise<GradeResult>;
	};
}

/**
 * 构造一个可点击的刷题窗口。
 *
 * 解析结果由真实的 `parseQuizFile` 生成，因此列表页显示的数字来自真实解析，
 * 而不是测试自己编的常量。
 *
 * `realCard` 为 true 时不替换题卡渲染器，走笔记里同一份 `renderQuizCard`：
 * 用来验证"窗口里真的能答题"。其余用例用替身，只观察窗口的行为。
 */
function buildHarness(files: { file: FakeFile; source: string }[], realCard = false): Harness {
	const parsedAt = new Map<string, ReturnType<typeof parseQuizFile>>();
	for (const item of files) parsedAt.set(item.file.path, parseQuizFile(item.source, item.file.path, options));

	const renders: { question: QuizQuestion; ctx: CardContext }[] = [];
	const submitted: { path: string; id: string }[] = [];

	const service = {
		listQuizFiles: () => files.map((item) => item.file),
		parseFile: async (file: FakeFile) => must(parsedAt.get(file.path), `缺少解析结果：${file.path}`),
		fileAtPath: (path: string) => files.find((item) => item.file.path === path)?.file ?? null,
		isQuizFile: () => true,
		updateSettings: () => undefined,
		submit: async (file: FakeFile, id: string): Promise<GradeResult> => {
			submitted.push({ path: file.path, id });
			// 约定：a2 判错，其余判对，方便断言进度与成绩单。
			const correct = id !== "a2";
			return { correct, details: [{ correct }], recorded: [] };
		},
	};
	const host: EasyQuizHost = {
		settings: {
			language: "auto",
			blockLanguage: "quiz",
			headingLevels: [2, 2],
			blankMarker: "highlight",
			pathGlobs: [],
			historyLimit: 10,
			writeBackEnabled: false,
		},
		service: service as unknown as EasyQuizHost["service"],
	};
	if (!realCard) {
		host.cardRenderer = async (question, ctx) => {
			renders.push({ question, ctx });
		};
	}

	const view = new PracticeView({ app: {} } as never, host, () => undefined);
	return { view, renders, submitted, service };
}

/** 两道题的题库：A 文件三道 + 子目录里的 B 文件一道。 */
function standardHarness(): Harness {
	return buildHarness([
		{ file: fakeFile("题库/甲.md", 1_700_000_000_000), source: BANK_A },
		{ file: fakeFile("题库/子目录/乙.md", 1_700_000_100_000), source: BANK_B },
	]);
}

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

function root(view: PracticeView): HTMLElement {
	return view.contentEl;
}

function find(view: PracticeView, selector: string, message: string): HTMLElement {
	return must(root(view).querySelector<HTMLElement>(selector) ?? undefined, message);
}

function findAll(view: PracticeView, selector: string): HTMLElement[] {
	return Array.from(root(view).querySelectorAll<HTMLElement>(selector));
}

function textOf(view: PracticeView): string {
	return root(view).textContent ?? "";
}

function click(el: HTMLElement, message = "点击目标不存在"): void {
	void message;
	el.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
}

function change(el: HTMLElement): void {
	el.dispatchEvent(new testWindow.Event("change", { bubbles: true }));
}

/** 等被点击触发的异步渲染跑完。 */
async function flush(): Promise<void> {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

/** 走完"选文件 → 进设置页"这两步。 */
async function openPicker(harness: Harness, path: string): Promise<void> {
	await harness.view.activate();
	click(find(harness.view, `button[data-action='pick-file-only'][data-path='${path}']`, "缺少「设置刷题」按钮"));
	await flush();
}

/** 从设置页开始一轮刷题。 */
async function startSession(harness: Harness): Promise<void> {
	click(find(harness.view, "button[data-action='start-session']", "缺少开始按钮"));
	await flush();
}

/** 取设置页上某个控件的替身，并按输入框的语义驱动它。 */
function driveText(view: PracticeView, action: string, value: string): void {
	for (const el of findAll(view, ".easy-quiz-practice__setting")) {
		const setting = (el as unknown as { setting?: Setting }).setting;
		if (setting === undefined) continue;
		for (const component of setting.components) {
			const candidate = component as unknown as {
				inputEl?: HTMLInputElement;
				setUserValue?: (text: string) => void;
			};
			if (candidate.inputEl?.dataset["action"] !== action) continue;
			const setter = must(candidate.setUserValue, `控件 ${action} 不支持输入`);
			setter.call(candidate, value);
			return;
		}
	}
	throw new Error(`设置页上找不到控件：${action}`);
}

// ---------------------------------------------------------------------------
// 页面 1：题库列表
// ---------------------------------------------------------------------------

test("题库列表按文件路径列出题库文件与题目数据", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	assertEqual(findAll(harness.view, ".easy-quiz-practice__file").length, 2, "两个题库文件应各占一行");
	const text = textOf(harness.view);
	assert(text.includes("题库/甲.md"), "应显示文件的完整路径");
	assert(text.includes("共 3 题"), "应显示题量");
	assert(text.includes("可作答 3"), "应显示可作答题数");
	assert(text.includes("单选 2"), "应显示题型分布");
	assert(text.includes("填空 1"), "应显示题型分布");
	assert(text.includes("题库/子目录"), "子目录应有分组标题");
	assert(text.includes("2 个题库文件"), "顶部应汇总文件数");
	assert(text.includes("4 道题"), "顶部应汇总题目总数");
	assert(text.includes("可作答 4"), "顶部应汇总可作答题数");
});

test("题库列表：解析失败的文件只影响自己那一行", async () => {
	const good = fakeFile("题库/甲.md");
	const bad = fakeFile("题库/坏.md");
	const parsed = parseQuizFile(BANK_A, good.path, options);
	const harness = buildHarness([{ file: good, source: BANK_A }]);
	harness.service.listQuizFiles = () => [good, bad];
	harness.service.parseFile = async (file: FakeFile) => {
		if (file.path === bad.path) throw new Error("坏掉的 YAML");
		return parsed;
	};

	await harness.view.activate();
	assertEqual(findAll(harness.view, ".easy-quiz-practice__file").length, 2, "两份文件都应出现");
	assert(textOf(harness.view).includes("解析失败：坏掉的 YAML"), "失败的文件应就地报错");
	assert(textOf(harness.view).includes("共 3 题"), "另一份文件的题量仍然正常");
});

test("题库列表：全选可作答后按钮显示已选份数且勾选框同步", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	click(find(harness.view, "button[data-action='select-all']", "缺少全选按钮"));
	await flush();

	assert(textOf(harness.view).includes("已选 2 份"), "两份文件都应被选中");
	const checks = findAll(harness.view, "input[data-action='pick-file']") as HTMLInputElement[];
	assertEqual(checks.length, 2, "每行一个勾选框");
	assert(
		checks.every((check) => check.checked),
		"勾选框应与选中状态一致"
	);
});

test("题库列表：单个勾选框改变后底部按钮跟着更新", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	const box = find(harness.view, "input[data-action='pick-file'][data-path='题库/甲.md']", "缺少勾选框") as HTMLInputElement;
	box.checked = true;
	change(box);

	assert(textOf(harness.view).includes("已选 1 份"), "勾选一份后按钮应显示 1 份");
	const start = find(harness.view, "button[data-action='to-picker']", "缺少进入设置按钮") as HTMLButtonElement;
	assert(!start.disabled, "有选中文件后进入设置应可用");
});

test("题库列表：没有题库文件时给出三种识别方式", async () => {
	const harness = buildHarness([]);
	await harness.view.activate();

	assert(textOf(harness.view).includes("没有找到题库文件"), "应说明没有题库");
	assert(textOf(harness.view).includes("quiz: true"), "应提示 frontmatter 写法");
	assert(textOf(harness.view).includes("#quiz"), "应提示标签写法");
	find(harness.view, "button[data-action='open-settings']", "应能从空状态打开设置");
});

// ---------------------------------------------------------------------------
// 页面 2：刷题设置
// ---------------------------------------------------------------------------

test("刷题设置显示选中文件的可作答数，默认顺序刷全部题", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");

	assert(textOf(harness.view).includes("题库/甲.md（可作答 3）"), "应显示选中文件的可作答数");
	assert(textOf(harness.view).includes("这一轮将刷 3 题"), "顺序模式应计划刷完全部");
	assertEqual(findAll(harness.view, "button[data-action='set-mode']").length, 3, "应有三个抽题方式");
});

test("定量随机抽题：数量受候选题上限约束", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");

	click(find(harness.view, "button[data-mode='random']", "缺少随机模式按钮"));
	await flush();
	assert(textOf(harness.view).includes("这一轮将刷 3 题"), "默认抽 20 题但只有 3 道候选");

	find(harness.view, "input[data-action='random-count']", "缺少数量输入框");
	driveText(harness.view, "random-count", "2");
	await flush();
	assert(textOf(harness.view).includes("这一轮将刷 2 题"), "输入 2 后应只抽 2 题");});

test("只刷某题型：勾选题型后候选只剩该题型", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");

	const box = find(harness.view, "input[data-type='blank']", "缺少填空题型的勾选框") as HTMLInputElement;
	box.checked = true;
	change(box);
	await flush();

	assert(textOf(harness.view).includes("符合当前条件 1 题"), "只勾填空题时应只剩 1 道");
	assert(textOf(harness.view).includes("这一轮将刷 1 题"), "计划题数应随题型变化");
});

test("只刷错题：没有错题记录时候选为 0 且无法开始", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");

	click(find(harness.view, "button[data-mode='wrong']", "缺少只刷错题按钮"));
	await flush();

	assert(textOf(harness.view).includes("符合当前条件 0 题"), "没有记录时应为 0 题");
	const start = find(harness.view, "button[data-action='start-session']", "缺少开始按钮") as HTMLButtonElement;
	assert(start.disabled, "没有候选题时开始按钮应禁用");
});

test("只刷错题：有错题记录时只抽出答错过的题", async () => {
	const source = BANK_A.replace("id: a2\ntype: single\nanswer: b", `id: a2\ntype: single\nanswer: b\n${WRONG_STATS}`);
	const harness = buildHarness([{ file: fakeFile("题库/甲.md"), source }]);
	await openPicker(harness, "题库/甲.md");

	click(find(harness.view, "button[data-mode='wrong']", "缺少只刷错题按钮"));
	await flush();
	assert(textOf(harness.view).includes("符合当前条件 1 题"), "只有一道题上次答错");

	await startSession(harness);
	assertEqual(harness.renders.length, 1, "这一轮只应有一道题");
	assertEqual(at(harness.renders, 0, "缺少渲染").question.id, "a2", "抽到的应是答错过的那道题");
});

test("刷题设置：移除选中的文件后回到空状态", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");

	click(find(harness.view, "button[data-action='unpick-file']", "缺少移除按钮"));
	await flush();

	assert(textOf(harness.view).includes("还没有选择题库文件"), "移除后应回到空状态");
	find(harness.view, "button[data-action='goto-list']", "应能返回题库列表");
});

// ---------------------------------------------------------------------------
// 页面 3：刷题
// ---------------------------------------------------------------------------

test("开始刷题：进入第三页并渲染第一道题", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	assertEqual(harness.renders.length, 1, "应渲染第一道题");
	assertEqual(at(harness.renders, 0, "缺少渲染").question.id, "a1", "顺序模式从第一道题开始");
	assertEqual(at(harness.renders, 0, "缺少渲染").ctx.reviewOnly, false, "刚开始时应是作答态");
	assert(textOf(harness.view).includes("第 1 / 3 题"), "应显示进度");
	assert(textOf(harness.view).includes("题库/甲.md"), "应显示题目所在文件");
	find(harness.view, "button[data-action='next-question']", "应有下一题按钮");
	find(harness.view, "button[data-action='prev-question']", "应有上一题按钮");
});

test("提交后把成绩计入进度，并由渲染层负责写回", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	// 模拟真实题卡的提交流程：点击提交 → 交给 QuizService → 把结果回报给窗口。
	const first = at(harness.renders, 0, "缺少渲染");
	const file = must(harness.service.fileAtPath("题库/甲.md") ?? undefined, "缺少文件");
	const outcome = await harness.service.submit(file, first.question.id);
	first.ctx.onSubmitted?.(outcome);
	await flush();

	assertEqual(harness.submitted.length, 1, "作答应交给 QuizService 判分与写回");
	assert(textOf(harness.view).includes("对 1 · 错 0 · 已答 1"), "进度应计一次答对");
});

test("用真实题卡渲染：选项、提交与复盘答案都在窗口里", async () => {
	// 这一条不替换 cardRenderer，走的是笔记里同一份 renderQuizCard。
	const harness = buildHarness([{ file: fakeFile("题库/甲.md"), source: BANK_A }], true);
	await harness.view.activate();
	click(find(harness.view, `button[data-action='pick-file-only'][data-path='题库/甲.md']`, "缺少设置按钮"));
	await flush();
	click(find(harness.view, "button[data-action='start-session']", "缺少开始按钮"));
	await flush();

	const options = findAll(harness.view, ".easy-quiz-card__option");
	assertEqual(options.length, 2, "单选题应渲染两个选项");
	click(options[0] as HTMLElement);
	click(find(harness.view, ".easy-quiz-card__actions button.mod-cta", "缺少提交按钮"));
	// 提交要经过一次 await（QuizService → 复盘重渲染）。
	for (let i = 0; i < 8; i++) await Promise.resolve();

	assertEqual(harness.submitted.length, 1, "点击提交应调用 QuizService");
	assert(textOf(harness.view).includes("回答正确"), "应给出对错反馈");
	assert(textOf(harness.view).includes("正确答案"), "复盘应给出正确答案");
	assert(textOf(harness.view).includes("选项一"), "复盘应写出正确选项的文本");
});

test("下一题：换题重画并把进度推到第二题", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);
	at(harness.renders, 0, "缺少第一次渲染").ctx.onSubmitted?.({ correct: true, details: [], recorded: [] });
	await flush();

	click(find(harness.view, "button[data-action='next-question']", "缺少下一题按钮"));
	await flush();

	assertEqual(harness.renders.length, 2, "应重新渲染卡片");
	assertEqual(at(harness.renders, 1, "缺少第二次渲染").question.id, "a2", "第二题应是 a2");
	assertEqual(at(harness.renders, 1, "缺少第二次渲染").ctx.reviewOnly, false, "新题应是作答态");
	assert(textOf(harness.view).includes("第 2 / 3 题"), "进度应推进到第二题");
});

test("上一题：回到已经答过的题时直接进入复盘态", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);
	at(harness.renders, 0, "缺少第一次渲染").ctx.onSubmitted?.({ correct: true, details: [], recorded: [] });
	await flush();
	click(find(harness.view, "button[data-action='next-question']", "缺少下一题按钮"));
	await flush();

	click(find(harness.view, "button[data-action='prev-question']", "缺少上一题按钮"));
	await flush();
	assertEqual(at(harness.renders, 2, "缺少第三次渲染").question.id, "a1", "应回到第一题");
	assertEqual(at(harness.renders, 2, "缺少第三次渲染").ctx.reviewOnly, true, "答过的题重看应是复盘态");
});

test("查看解析：直接进入复盘态且不计分", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	click(find(harness.view, "button[data-action='peek']", "缺少查看解析按钮"));
	await flush();

	assertEqual(harness.renders.length, 2, "应重画卡片");
	assertEqual(at(harness.renders, 1, "缺少第二次渲染").ctx.reviewOnly, true, "看答案后应是复盘态");
	assert(textOf(harness.view).includes("已答 0"), "看答案不算作答");
});

test("走完最后一题给出成绩单，并可以只重做错题", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	// 三道题：第一题答对，后两题答错，然后看成绩单。
	at(harness.renders, 0, "缺少第 1 题").ctx.onSubmitted?.({ correct: true, details: [], recorded: [] });
	await flush();
	click(find(harness.view, "button[data-action='next-question']", "缺少下一题按钮"));
	await flush();
	at(harness.renders, 1, "缺少第 2 题").ctx.onSubmitted?.({ correct: false, details: [], recorded: [] });
	await flush();
	click(find(harness.view, "button[data-action='next-question']", "缺少下一题按钮"));
	await flush();
	at(harness.renders, 2, "缺少第 3 题").ctx.onSubmitted?.({ correct: false, details: [], recorded: [] });
	await flush();

	click(find(harness.view, "button[data-action='next-question']", "缺少查看本轮结果按钮"));
	await flush();

	assert(textOf(harness.view).includes("本轮结果"), "应显示成绩单");
	assert(textOf(harness.view).includes("共 3 题 · 已作答 3 · 正确 1 · 错误 2"), "成绩应统计三次作答");
	assert(textOf(harness.view).includes("本轮答错的题"), "应列出答错的题");

	click(find(harness.view, "button[data-action='retry-wrong']", "缺少只重做错题按钮"));
	await flush();
	assertEqual(harness.renders.length, 4, "应重新渲染一道题");
	assert(textOf(harness.view).includes("第 1 / 2 题"), "只重做错题时应是两道题的一轮");
});

test("结束本轮：直接给出成绩单", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	click(find(harness.view, "button[data-action='end-session']", "缺少结束本轮按钮"));
	await flush();

	assert(textOf(harness.view).includes("本轮结果"), "结束本轮应跳到成绩单");
	assert(textOf(harness.view).includes("已作答 0"), "没有作答时统计为 0");
});

/** 驱动设置行上的开关（设置页上只有一个开关：打乱顺序）。 */
function driveToggle(view: PracticeView, value: boolean): void {
	for (const el of findAll(view, ".easy-quiz-practice__setting")) {
		const setting = (el as unknown as { setting?: Setting }).setting;
		if (setting === undefined) continue;
		for (const component of setting.components) {
			const candidate = component as unknown as { setUserValue?: (v: boolean) => void; inputEl?: unknown };
			if (candidate.inputEl !== undefined) continue;
			const setter = must(candidate.setUserValue, "设置行上的开关不支持切换");
			setter.call(candidate, value);
			return;
		}
	}
	throw new Error("设置页上找不到开关");
}

test("打乱顺序：打开后仍是同一批题，只是顺序由随机决定", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");

	driveToggle(harness.view, true);
	await startSession(harness);

	assertEqual(harness.renders.length, 1, "应只渲染当前一道题");
	const first = at(harness.renders, 0, "缺少渲染").question.id;
	assert(["a1", "a2", "a3"].includes(first), `抽到的应是候选里的题，实际 ${first}`);
	assert(textOf(harness.view).includes("第 1 / 3 题"), "打乱顺序不改变题量");
});

test("顶部步骤往回走：从刷题页回到题库列表且统计仍然可用", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	click(find(harness.view, "[data-action='goto-step'][data-step='0']", "缺少第一步导航"));
	await flush();

	assert(textOf(harness.view).includes("题库文件"), "应回到题库列表");
	assertEqual(findAll(harness.view, ".easy-quiz-practice__file").length, 2, "列表应重新画出");
});
