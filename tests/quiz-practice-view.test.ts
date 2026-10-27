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
			headingMode: "level",
			blankMarker: "highlight",
			pathGlobs: [],
			historyLimit: 10,
			writeBackEnabled: false,
			showStaleHint: false,
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

function find(view: PracticeView, selector: string, message = `未找到 ${selector}`): HTMLElement {
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
// 页面 1：搜索与折叠
// ---------------------------------------------------------------------------

/** 在搜索框里输入内容（模拟用户打字）。 */
function search(view: PracticeView, value: string): void {
	const box = find(view, "input[data-action='search']", "缺少搜索框") as HTMLInputElement;
	box.value = value;
	box.dispatchEvent(new testWindow.Event("input", { bubbles: true }));
}

/** 点一下文件夹标题（折叠 / 展开）。 */
function toggleFolder(view: PracticeView, folder: string): void {
	click(find(view, `.easy-quiz-practice__folder[data-folder='${folder}']`, `缺少文件夹 ${folder} 的标题`));
}

/** 当前画出来的文件行路径。 */
function visibleFiles(view: PracticeView): string[] {
	return findAll(view, ".easy-quiz-practice__file").map(
		(row) => (row.querySelector<HTMLElement>(".easy-quiz-practice__file-path")?.textContent ?? "").replace(/^\//, "")
	);
}

test("题库列表：搜索按文件名或路径过滤，并给出匹配数", async () => {
	const harness = standardHarness();
	await harness.view.activate();
	assertEqual(visibleFiles(harness.view).length, 2, "搜索前两份文件都在");

	search(harness.view, "乙");
	assertEqual(visibleFiles(harness.view).join(","), "题库/子目录/乙.md", "按文件名应只剩乙");
	assert(textOf(harness.view).includes("匹配到 1 个题库文件"), "应显示匹配数");

	// 换成路径片段：甲不在结果里，则说明比对确实覆盖了完整路径。
	search(harness.view, "题库/甲");
	assertEqual(visibleFiles(harness.view).join(","), "题库/甲.md", "按路径应只剩甲");

	// 清空搜索后恢复全量，且匹配数那行收起来。
	search(harness.view, "");
	assertEqual(visibleFiles(harness.view).length, 2, "清空搜索后应恢复全部");
	assert(
		find(harness.view, ".easy-quiz-practice__matched", "缺少匹配数一行").classList.contains("is-hidden"),
		"没有搜索词时匹配数应隐藏"
	);
});

test("题库列表：搜索没有命中时给出说明，而不是空白列表", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	search(harness.view, "不存在的题库");
	assertEqual(visibleFiles(harness.view).length, 0, "不应再有文件行");
	assert(textOf(harness.view).includes("没有题库文件匹配"), "应说明没有命中");
	assert(textOf(harness.view).includes("不存在的题库"), "说明里应带上搜索词");
});

test("题库列表：搜索不改变已经勾选的文件", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	const box = find(harness.view, "input[data-action='pick-file'][data-path='题库/甲.md']", "缺少勾选框") as HTMLInputElement;
	box.checked = true;
	change(box);

	// 搜到别的文件：甲被过滤掉不再显示，但选择必须留着（否则搜索就成了隐式清空）。
	search(harness.view, "乙");
	assert(!textOf(harness.view).includes("/题库/甲.md"), "搜索时甲不在结果里");
	assert(textOf(harness.view).includes("已选 1 份"), "勾选不应被搜索清掉");

	search(harness.view, "");
	assertEqual(
		(find(harness.view, "input[data-action='pick-file'][data-path='题库/甲.md']", "缺少勾选框") as HTMLInputElement).checked,
		true,
		"恢复搜索后甲仍是勾上的"
	);
});

test("题库列表：点文件夹标题折叠与展开该组", async () => {
	const harness = standardHarness();
	await harness.view.activate();
	assertEqual(visibleFiles(harness.view).length, 2, "初始两份文件都可见");

	toggleFolder(harness.view, "题库/子目录");
	assertEqual(visibleFiles(harness.view).join(","), "题库/甲.md", "折叠后该组内的文件不再显示");
	find(harness.view, ".easy-quiz-practice__folder[data-folder='题库/子目录']", "折叠后标题仍应在");

	toggleFolder(harness.view, "题库/子目录");
	assertEqual(visibleFiles(harness.view).length, 2, "再点一次应展开");
});

test("题库列表：全部折叠 / 全部展开作用于所有文件夹", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	click(find(harness.view, "button[data-action='fold-all']", "缺少全部折叠按钮"));
	await flush();
	assertEqual(visibleFiles(harness.view).length, 0, "全部折叠后不应有文件行");
	assertEqual(findAll(harness.view, ".easy-quiz-practice__folder").length, 2, "两个文件夹标题都要留着");

	click(find(harness.view, "button[data-action='unfold-all']", "缺少全部展开按钮"));
	await flush();
	assertEqual(visibleFiles(harness.view).length, 2, "全部展开后文件应回来");
});

test("题库列表：文件夹标题上的勾选框整组勾选", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	const box = find(
		harness.view,
		"input[data-action='pick-folder'][data-folder='题库']",
		"缺少题库文件夹的整组勾选框"
	) as HTMLInputElement;
	box.checked = true;
	change(box);

	assert(textOf(harness.view).includes("已选 1 份"), "整组勾选应选中该文件夹里的甲");
	assertEqual(
		(find(harness.view, "input[data-action='pick-file'][data-path='题库/甲.md']", "缺少勾选框") as HTMLInputElement).checked,
		true,
		"组内文件行要同步勾上"
	);
	assertEqual(
		(find(harness.view, "input[data-action='pick-file'][data-path='题库/子目录/乙.md']", "缺少勾选框") as HTMLInputElement).checked,
		false,
		"别的文件夹不应被带上"
	);

	// 取消整组：组内文件也要一起放下。
	box.checked = false;
	change(box);
	assert(textOf(harness.view).includes("已选 0 份"), "取消整组后应一份不剩");
});

test("题库列表：组内全勾后文件夹勾选框显示为已选", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	const file = find(harness.view, "input[data-action='pick-file'][data-path='题库/甲.md']", "缺少勾选框") as HTMLInputElement;
	file.checked = true;
	change(file);

	const group = find(harness.view, "input[data-action='pick-folder'][data-folder='题库']", "缺少整组勾选框") as HTMLInputElement;
	assertEqual(group.checked, true, "组内唯一的文件被勾上后，整组勾选框应显示已选");
	assertEqual(group.indeterminate, false, "全选时不该是半勾");
});

test("题库列表：搜索后全选只作用于当前结果", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	search(harness.view, "乙");
	click(find(harness.view, "button[data-action='select-all']", "缺少全选按钮"));
	await flush();

	assert(textOf(harness.view).includes("已选 1 份"), "只应选中搜索结果里的那一份");

	// 清空搜索才看得到甲：它不该被刚才那次全选带上。
	search(harness.view, "");
	const boxA = find(harness.view, "input[data-action='pick-file'][data-path='题库/甲.md']", "缺少甲的勾选框") as HTMLInputElement;
	const boxB = find(
		harness.view,
		"input[data-action='pick-file'][data-path='题库/子目录/乙.md']",
		"缺少乙的勾选框"
	) as HTMLInputElement;
	assertEqual(boxA.checked, false, "被搜索词排除的甲不该被选中");
	assertEqual(boxB.checked, true, "搜索结果里的乙应已勾上");
});

test("题库列表：清空搜索按钮在输入后可用", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	const clear = find(harness.view, "button[data-action='clear-search']", "缺少清空搜索按钮") as HTMLButtonElement;
	assert(clear.disabled, "没有搜索词时清空按钮应禁用");

	search(harness.view, "甲");
	assert(!clear.disabled, "有搜索词后清空按钮应可用");

	click(clear);
	await flush();
	assertEqual(visibleFiles(harness.view).length, 2, "点清空后应恢复全部文件");
	assertEqual((find(harness.view, "input[data-action='search']", "缺少搜索框") as HTMLInputElement).value, "", "搜索框应被清空");
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
	// 数量只对随机模式有意义：顺序模式下留一个灰掉的输入框既占一行又像没填完。
	assertEqual(
		findAll(harness.view, "input[data-action='random-count']").length,
		0,
		"顺序模式下不应显示数量输入框",
	);
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

test("改选另一个题库后，这一轮只刷新选中的文件", async () => {
	const harness = standardHarness();
	// 先选甲并进入设置页：甲此时已经被解析并缓存在窗口里。
	await openPicker(harness, "题库/甲.md");
	// 返回题库列表，取消勾选甲，改勾子目录里的乙。
	click(find(harness.view, "button[data-action='goto-list']", "缺少返回题库列表按钮"));
	await flush();

	const boxA = find(
		harness.view,
		"input[data-action='pick-file'][data-path='题库/甲.md']",
		"缺少甲的勾选框"
	) as HTMLInputElement;
	boxA.checked = false;
	change(boxA);
	const boxB = find(
		harness.view,
		"input[data-action='pick-file'][data-path='题库/子目录/乙.md']",
		"缺少乙的勾选框"
	) as HTMLInputElement;
	boxB.checked = true;
	change(boxB);
	click(find(harness.view, "button[data-action='to-picker']", "缺少进入设置按钮"));
	await flush();

	assert(textOf(harness.view).includes("符合当前条件 1 题"), "只选乙时候选应只有 1 道题");
	assert(!textOf(harness.view).includes("题库/甲.md（"), "设置页不应再列出已经取消勾选的甲");

	await startSession(harness);
	assertEqual(harness.renders.length, 1, "这一轮只应渲染新选中文件的题");
	assertEqual(at(harness.renders, 0, "缺少渲染").question.id, "b1", "抽到的应是乙文件里的题");
	assertEqual(at(harness.renders, 0, "缺少渲染").ctx.file.path, "题库/子目录/乙.md", "题卡应指向乙文件");
	// 队列长度是"叠加"最直接的证据：甲的三道题不该混进来。
	assert(textOf(harness.view).includes("第 1 / 1 题"), "这一轮队列只应有乙的那一道题");
});

test("改选题库：先选子目录文件再改选根目录文件同样不叠加", async () => {
	const harness = standardHarness();
	// 与上一条方向相反：先选乙（1 题），再改选甲（3 题）。
	await openPicker(harness, "题库/子目录/乙.md");
	click(find(harness.view, "button[data-action='goto-list']", "缺少返回题库列表按钮"));
	await flush();

	const boxB = find(
		harness.view,
		"input[data-action='pick-file'][data-path='题库/子目录/乙.md']",
		"缺少乙的勾选框"
	) as HTMLInputElement;
	boxB.checked = false;
	change(boxB);
	const boxA = find(
		harness.view,
		"input[data-action='pick-file'][data-path='题库/甲.md']",
		"缺少甲的勾选框"
	) as HTMLInputElement;
	boxA.checked = true;
	change(boxA);
	click(find(harness.view, "button[data-action='to-picker']", "缺少进入设置按钮"));
	await flush();

	assert(textOf(harness.view).includes("符合当前条件 3 题"), "只选甲时候选应是 3 道题");
	await startSession(harness);
	assertEqual(at(harness.renders, 0, "缺少渲染").ctx.file.path, "题库/甲.md", "题卡应指向甲文件");
	assert(textOf(harness.view).includes("第 1 / 3 题"), "这一轮队列应只含甲的 3 道题");
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

	// 角标是在渲染时按文件记录算的，刚提交这一次还没写回副本可读：必须就地补上，
	// 否则复盘时「回答正确」旁边还挂着「未作答」。
	const badge = find(harness.view, ".easy-quiz-card__stats", "缺少统计角标");
	const badgeText = badge.textContent ?? "";
	assert(!badgeText.includes("未作答"), `提交后角标应反映这次作答（实际：${badgeText}）`);
	assert(badgeText.includes("1/1"), `角标应记下一次作答（实际：${badgeText}）`);

	// 提交按钮只是藏起来，整行仍占高度——复盘区和选项之间会多出一段空白。
	const actions = find(harness.view, ".easy-quiz-card__actions", "缺少提交按钮行");
	assert(actions.classList.contains("is-hidden"), "提交后整行应被收起");
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

/**
 * 开关必须一路传到题卡：`shuffleOptions` 决定选择题的选项顺序，
 * 只看题序打乱是不够的——README 与设置页的说明都承诺了「打乱选项顺序」。
 */
test("打乱顺序：开关会传给题卡，并带上一颗本轮固定的种子", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");

	// 未打开时不应打乱选项。
	await startSession(harness);
	assertEqual(at(harness.renders, 0, "缺少渲染").ctx.shuffleOptions, false, "默认不打乱选项");

	// 回到设置页打开开关，再开始一轮。
	click(find(harness.view, "[data-action='goto-step'][data-step='1']", "缺少第二步导航"));
	await flush();
	driveToggle(harness.view, true);
	await startSession(harness);

	const ctx = at(harness.renders, 1, "缺少第二次渲染").ctx;
	assertEqual(ctx.shuffleOptions, true, "开关应传给题卡");
	assert(typeof ctx.shuffleSeed === "number", "应带上一颗种子，供选项顺序复现");
});

/**
 * 同一轮里切题来回不能换一副牌：题卡每次渲染都拿到同一颗种子，
 * 选项顺序因此稳定（否则用户刚记住的位置会变，看起来像"答案认错了"）。
 */
test("打乱顺序：同一轮内每一题拿到的种子相同", async () => {
	const harness = standardHarness();
	await openPicker(harness, "题库/甲.md");
	driveToggle(harness.view, true);
	await startSession(harness);

	at(harness.renders, 0, "缺少渲染").ctx.onSubmitted?.({ correct: true, details: [], recorded: [] });
	await flush();
	click(find(harness.view, "button[data-action='next-question']", "缺少下一题按钮"));
	await flush();

	const first = at(harness.renders, 0, "缺少第一次渲染").ctx.shuffleSeed;
	const second = at(harness.renders, 1, "缺少第二次渲染").ctx.shuffleSeed;
	assertEqual(second, first, "同一轮内种子应保持一致");
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

// ---------------------------------------------------------------------------
// 从文件菜单直接进入某个题库的刷题设置
// ---------------------------------------------------------------------------

test("openPickerFor：直接进入该题库的刷题设置页", async () => {
	const harness = standardHarness();
	await harness.view.openPickerFor("题库/子目录/乙.md");

	assert(textOf(harness.view).includes("刷题设置"), "应停在刷题设置页");
	assert(textOf(harness.view).includes("题库/子目录/乙.md（可作答 1）"), "应选中菜单里点的那份题库");
	assert(textOf(harness.view).includes("这一轮将刷 1 题"), "设置页应已经算好题数");
});

test("openPickerFor：丢弃上一轮的选择，只留这一份题库", async () => {
	const harness = standardHarness();
	// 先在列表页选中两份，再从文件菜单点一份：菜单的意图是"就刷这个"。
	await harness.view.activate();
	click(find(harness.view, "button[data-action='select-all']", "缺少全选按钮"));
	await flush();
	assert(textOf(harness.view).includes("已选 2 份"), "先选中两份");

	await harness.view.openPickerFor("题库/甲.md");
	assert(textOf(harness.view).includes("符合当前条件 3 题"), "只应剩甲的三道题");
	assert(!textOf(harness.view).includes("题库/子目录/乙.md（"), "乙不该留在选择里");
});

test("openPickerFor：文件不存在时设置页给出空状态而不是报错", async () => {
	const harness = standardHarness();
	await harness.view.openPickerFor("题库/已经没有这个文件.md");

	// 选中的路径解析不出文件时，设置页按 0 题处理：不抛错、也点不动开始。
	assert(textOf(harness.view).includes("符合当前条件 0 题"), "找不到文件时按 0 题处理");
	const start = find(harness.view, "button[data-action='start-session']", "缺少开始按钮") as HTMLButtonElement;
	assert(start.disabled, "没有候选题时开始按钮应禁用");
});

// ---------------------------------------------------------------------------
// 本次新增：文件夹半选、缓存指纹、切回已答题目
// ---------------------------------------------------------------------------

test("题库列表：同一文件夹里的部分文件被选中时，文件夹勾选框显示半选", async () => {
	const harness = buildHarness([
		{ file: fakeFile("题库/甲.md"), source: BANK_A },
		{ file: fakeFile("题库/丙.md"), source: BANK_A },
		{ file: fakeFile("题库/子目录/乙.md"), source: BANK_B },
	]);
	await harness.view.activate();

	// 路径排序会把 `题库/子目录/乙.md` 插在 `题库/甲.md` 与 `题库/丙.md` 之间：
	// 分组必须按文件夹收拢，否则同一个「题库」会被拆成两个分组。
	const group = must(
		root(harness.view).querySelector<HTMLElement>(".easy-quiz-practice__group[data-folder='题库']") ??
			undefined,
		"应有一个「题库」分组"
	);
	assertEqual(
		group.querySelectorAll("input[data-action='pick-file']").length,
		2,
		"「题库」分组应包含两个直接位于该文件夹的题库"
	);
	const check = must(
		group.querySelector<HTMLInputElement>("input[data-action='pick-folder']") ?? undefined,
		"文件夹标题上应有勾选框"
	);

	click(find(harness.view, "input[data-action='pick-file'][data-path='题库/甲.md']"));
	await flush();
	assertEqual(check.checked, false, "只选中一份时不应整组勾选");
	assertEqual(check.indeterminate, true, "部分选中时应显示半选");

	click(find(harness.view, "input[data-action='pick-file'][data-path='题库/丙.md']"));
	await flush();
	assertEqual(check.checked, true, "整组都选中时应勾选");
	assertEqual(check.indeterminate, false, "整组选中后不应再有半选状态");
});

test("题库列表：文件集合或修改时间变化后，扫描会自己重新解析", async () => {
	const harness = standardHarness();
	await harness.view.activate();

	// `scan()` 是私有方法：这里直接调用它验证缓存指纹，不必绕一整圈 UI。
	const scan = (): Promise<unknown[]> =>
		(harness.view as unknown as { scan: () => Promise<unknown[]> }).scan();
	assertEqual((await scan()).length, 2, "初始应扫描到两份文件");

	// 新增一份文件并让解析器认得它：指纹变化后必须重新扫描，而不是沿用旧缓存。
	const extra = fakeFile("题库/新增.md", 1_700_000_200_000);
	harness.service.listQuizFiles = () => [
		fakeFile("题库/甲.md", 1),
		fakeFile("题库/子目录/乙.md", 2),
		extra,
	];
	harness.service.parseFile = async (file) => parseQuizFile(BANK_B, file.path, options);
	assertEqual((await scan()).length, 3, "文件集合变化后应重新扫描到三份");
});

test("刷题页：切回已答题目时显示上次的选择，并刷新统计角标", async () => {
	const harness = buildHarness([{ file: fakeFile("题库/甲.md"), source: BANK_A }], true);
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	// 第一题选第二项（错误项 b）并提交。
	const rows = findAll(harness.view, ".easy-quiz-card__option");
	assert(rows.length >= 2, "第一题应有可点的选项");
	click(must(rows[1], "缺少第二个选项"));
	const submit = must(
		root(harness.view).querySelector<HTMLElement>(".easy-quiz-card__actions button") ?? undefined,
		"缺少提交按钮"
	);
	click(submit);
	await flush();

	// 前进一题再回来：复盘态应该同时给出「你的作答」和更新后的统计。
	click(find(harness.view, "button[data-action='next-question']"));
	await flush();
	click(find(harness.view, "button[data-action='prev-question']"));
	await flush();

	const picked = root(harness.view).querySelector<HTMLElement>(".easy-quiz-card__option.is-selected");
	assert(picked !== null, "切回后应标出上次选中的选项");
	assert(picked?.classList.contains("is-wrong") === true, "选错的项应标成错误");
	assert(
		root(harness.view).querySelector(".easy-quiz-card__review-answer-list") !== null,
		"复盘应列出「你的作答」"
	);
	// 替身服务按题目 id 判分（a1 判对），这里验证的是角标跟着写回更新，而不是判分规则。
	assertEqual(textOf(harness.view).includes("1/1"), true, "统计角标应更新为 1/1");
});

test("刷题页：题目卡片右上方提供打开原题笔记的编辑按钮", async () => {
	const harness = buildHarness([{ file: fakeFile("题库/甲.md"), source: BANK_A }], true);
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);
	const buttons = findAll(harness.view, ".easy-quiz-card__header button.easy-quiz-card__edit");
	assert(buttons.length === 1, "每题都应在卡片右上方有一个编辑按钮");
	assert(
		findAll(harness.view, "button[data-action='open-source']").length === 0,
		"导航栏不应再重复放打开按钮"
	);
});

test("刷题页：打开按钮用链接跳到题目标题（知识点链接里的 # 不会拆坏子路径）", async () => {
	const heading = "单选题甲 ^[[[300 笔记/内科/【内科】ARDS#呼吸窘迫]]]";
	const source = [
		"---",
		"quiz: true",
		"---",
		"",
		`## ${heading}`,
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
	];
	const harness = buildHarness(
		[{ file: fakeFile("题库/甲.md"), source: source.join(String.fromCharCode(10)) }],
		true
	);
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	const links: { link: string; sourcePath: string }[] = [];
	(harness.view as unknown as { app: unknown }).app = {
		metadataCache: {
			getFileCache: () => ({
				headings: [{ heading, position: { start: { line: 4 } } }],
			}),
		},
		workspace: {
			openLinkText: (link: string, sourcePath: string) => {
				links.push({ link, sourcePath });
			},
		},
	};

	click(find(harness.view, "button.easy-quiz-card__edit"));
	await flush();

	assertEqual(
		links[0]?.link,
		"题库/甲.md#单选题甲 [300 笔记/内科/【内科】ARDS 呼吸窘迫 ]",
		"应把带知识点链接的标题转成 Obsidian 链接写法"
	);
});

test("刷题页：缓存里没有标题时退回普通标题", async () => {
	const harness = buildHarness([{ file: fakeFile("题库/甲.md"), source: BANK_A }], true);
	await openPicker(harness, "题库/甲.md");
	await startSession(harness);

	const links: string[] = [];
	(harness.view as unknown as { app: unknown }).app = {
		metadataCache: { getFileCache: () => ({}) },
		workspace: {
			openLinkText: (link: string) => {
				links.push(link);
			},
		},
	};

	click(find(harness.view, "button.easy-quiz-card__edit"));
	await flush();

	assertEqual(links[0], "题库/甲.md#单选题甲", "没有缓存标题时应使用题目标题");
});
