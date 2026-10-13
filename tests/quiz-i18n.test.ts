/**
 * 语言适配的测试（jsdom）。
 *
 * 其余测试统一用中文跑（见 `harness.ts`），这一条专门盯英文：
 *   - 语言探测与设置项的组合（`auto` / 强制指定）；
 *   - 两份文案表的键与占位符必须一一对应，否则会出现"某处漏了 `{count}`"这类错译；
 *   - 英文下真的渲染出英文界面（纯逻辑、题卡、刷题窗口各走一遍），
 *     证明文案是渲染时取的，切换语言不需要重载插件。
 */

import * as yaml from "js-yaml";
import { setupDom } from "./dom";

const { window: testWindow, document } = setupDom();

import { contentHash } from "../src/hash";
import { detectLanguage, getLanguage, Language, normalizeLanguage, resolveLanguage, setLanguage, t } from "../src/i18n";
import { en } from "../src/i18n/en";
import { zh } from "../src/i18n/zh";
import { buildQuestionTemplate } from "../src/insert";
import { InsertQuestionModal } from "../src/insert-modal";
import { defaultTitles, typeLabel } from "../src/labels";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { EasyQuizHost, PracticeView } from "../src/practice-view";
import { QUIZ_TYPES, QuizQuestion } from "../src/types";
import { renderQuizCard } from "../src/view";
import { assert, assertEqual, at, must, test } from "./harness";
import { ButtonComponent } from "./obsidian-stub";

const options: ParseOptions = { deps: { parseYaml: (source) => yaml.load(source), hash: contentHash } };

/**
 * 在指定语言下跑一段断言，无论成功与否都切回中文。
 *
 * 其余用例是按中文断言的（`harness.ts` 把默认语言设为中文），
 * 这里用 finally 兜住失败路径，避免一条失败把后面的用例全带偏。
 */
async function inLanguage(language: Language, run: () => void | Promise<void>): Promise<void> {
	setLanguage(language);
	try {
		await run();
	} finally {
		setLanguage("zh");
	}
}

/** 语言标识收敛：只认得出中英两种，其余交给调用方兜底。 */
test("normalizeLanguage：识别中英及各自的地区变体", () => {
	assertEqual(normalizeLanguage("zh"), "zh", "zh");
	assertEqual(normalizeLanguage("zh-CN"), "zh", "zh-CN");
	assertEqual(normalizeLanguage("zh-Hant"), "zh", "zh-Hant");
	assertEqual(normalizeLanguage("ZH_tw"), "zh", "大小写与下划线也要认");
	assertEqual(normalizeLanguage("en"), "en", "en");
	assertEqual(normalizeLanguage("en-GB"), "en", "en-GB");
	assertEqual(normalizeLanguage(""), null, "空串认不出来");
	assertEqual(normalizeLanguage("  "), null, "只有空白也认不出来");
	assertEqual(normalizeLanguage("fr"), null, "不支持的语言认不出来");
	assertEqual(normalizeLanguage(undefined), null, "undefined 认不出来");
});

test("detectLanguage：按来源顺序取第一个能识别的语言", () => {
	assertEqual(detectLanguage(["zh", "en-US"]), "zh", "第一个来源优先");
	assertEqual(detectLanguage([null, "", "zh-TW"]), "zh", "认不出来的来源会被跳过");
	assertEqual(detectLanguage([null, undefined]), "en", "全都认不出来时回落到英文");
	assertEqual(detectLanguage([]), "en", "没有来源时回落到英文");
});

test("resolveLanguage：强制指定时忽略探测结果", () => {
	assertEqual(resolveLanguage("auto", ["zh-CN"]), "zh", "auto 用探测结果");
	assertEqual(resolveLanguage("auto", ["fr"]), "en", "auto 探测不到时用兜底语言");
	assertEqual(resolveLanguage("en", ["zh-CN"]), "en", "强制英文");
	assertEqual(resolveLanguage("zh", ["en-US"]), "zh", "强制中文");
});

test("两份文案表的键完全相同，且没有空文案", () => {
	const enKeys = Object.keys(en).sort();
	const zhKeys = Object.keys(zh).sort();
	assertEqual(zhKeys.join(","), enKeys.join(","), "中英文案表的键必须一一对应");
	for (const key of enKeys) {
		const english = en[key as keyof typeof en];
		const chinese = zh[key as keyof typeof zh];
		assert(english.trim() !== "", `英文文案为空：${key}`);
		assert(chinese.trim() !== "", `中文文案为空：${key}`);
	}
});

test("同一条文案在两种语言下使用同一组占位符", () => {
	const placeholders = (text: string): string[] => (text.match(/\{(\w+)\}/g) ?? []).sort();
	for (const key of Object.keys(en) as (keyof typeof en)[]) {
		assertEqual(
			placeholders(zh[key]).join(","),
			placeholders(en[key]).join(","),
			`占位符不一致：${key}`
		);
	}
});

test("t()：替换占位符，缺失的参数原样保留", () => {
	assertEqual(t("card.blank.label", { index: 3 }), "第 3 空", "中文占位符");
	assertEqual(t("practice.session.index", { index: 2, total: 5 }), "第 2 / 5 题", "多个占位符");
	assertEqual(t("card.blank.label"), "第 {index} 空", "没传参数时占位符原样保留");
	assertEqual(t("card.blank.label", { other: 1 }), "第 {index} 空", "参数名不对时也原样保留");
});

test("语言是渲染时取的：同一条文案会跟着 setLanguage 变", () => {
	setLanguage("zh");
	const chinese = t("card.submit");
	setLanguage("en");
	const english = t("card.submit");
	setLanguage("zh");
	assertEqual(chinese, "提交答案", "中文提交按钮");
	assertEqual(english, "Submit answer", "英文提交按钮");
	assertEqual(t("card.submit"), "提交答案", "切回中文后仍是中文");
	assertEqual(getLanguage(), "zh", "当前语言");
});

// ---------------------------------------------------------------------------
// 英文界面
// ---------------------------------------------------------------------------

/** 一道带知识点链接的单选题。 */
function parseSingle(): QuizQuestion {
	const source = [
		"---",
		"quiz: true",
		"---",
		"",
		"## How many handshakes does TCP need? ^[[Network/Transport#TCP handshake]]",
		"",
		"- One ^a",
		"- Three ^c",
		"",
		"```quiz",
		"type: single",
		"answer: c",
		"```",
	].join("\n");
	return must(parseQuizFile(source, "banks/net.md", options).questions[0], "未解析出题目");
}

/** 记录一次作答的假服务：题卡提交按钮点下去就会走这里。 */
function fakeService(correct: boolean) {
	const submissions: string[] = [];
	return {
		submissions,
		submit: async (_file: unknown, id: string) => {
			submissions.push(id);
			return { correct, details: [{ correct, note: correct ? undefined : "Wrong" }], recorded: [] };
		},
	};
}

async function renderCard(question: QuizQuestion, service: unknown, reviewOnly = false): Promise<HTMLElement> {
	const card = document.createElement("div");
	document.body.appendChild(card);
	await renderQuizCard(question, {
		app: {},
		service,
		file: { path: "banks/net.md" },
		el: card,
		blankMarker: "highlight",
		reviewOnly,
	} as unknown as Parameters<typeof renderQuizCard>[1]);
	return card;
}

/** 等提交后的复盘重渲染跑完（与其它 DOM 测试一致的做法）。 */
async function flush(): Promise<void> {
	for (let i = 0; i < 8; i++) await Promise.resolve();
}

test("英文：题卡头部、角标与提交按钮都是英文", async () => {
	await inLanguage("en", async () => {
		const card = await renderCard(parseSingle(), fakeService(false));
		const text = card.textContent ?? "";
		assertEqual(card.querySelector(".easy-quiz-card__type")?.textContent, "Single choice", "题型角标");
		assertEqual(card.querySelector(".easy-quiz-card__stats")?.textContent, "Not attempted", "未作答角标");
		assertEqual(card.querySelector(".easy-quiz-card__knowledge-label")?.textContent, "Knowledge point", "知识点行");
		assertEqual(card.querySelector(".easy-quiz-card__actions button")?.textContent, "Submit answer", "提交按钮");
		assert(text.includes("How many handshakes does TCP need?"), "题面标题原样显示");
		assert(!text.includes("提交答案"), "英文界面不应出现中文按钮");
	});
});

test("英文：提交后的对错反馈与复盘文案", async () => {
	await inLanguage("en", async () => {
		const service = fakeService(true);
		const card = await renderCard(parseSingle(), service);
		const option = must(card.querySelector<HTMLElement>(".easy-quiz-card__option") ?? undefined, "缺少选项");
		option.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
		const submit = must(
			card.querySelector<HTMLElement>(".easy-quiz-card__actions button") ?? undefined,
			"缺少提交按钮"
		);
		submit.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
		await flush();

		assertEqual(service.submissions.length, 1, "应提交一次");
		const text = card.textContent ?? "";
		assert(text.includes("Correct"), "应给出英文对错反馈");
		assert(text.includes("Correct answer"), "复盘应给出英文标题");
		assert(text.includes("c (Three)"), "复盘应写出锚点与选项文本");
	});
});

test("英文：降级题的诊断卡片是英文", async () => {
	await inLanguage("en", async () => {
		const broken: QuizQuestion = {
			...parseSingle(),
			ok: false,
			warnings: [
				{
					code: "missing-block",
					message: t("parser.blockMissing", { language: "quiz" }),
					questionIndex: 0,
					line: 5,
				},
			],
		};
		const card = await renderCard(broken, fakeService(false));
		const text = card.textContent ?? "";
		assert(text.includes("This question cannot be answered yet"), `应显示英文诊断提示（实际：${text}）`);
		assert(text.includes("(line 6)"), "应显示行号");
		assert(!/[\u4e00-\u9fff]/.test(text), `诊断卡片不应有中文（实际：${text}）`);
	});
});

test("英文：解析器提示是英文", async () => {
	await inLanguage("en", () => {
		const parsed = parseQuizFile(["", "## No block here", "", "Body.", ""].join("\n"), "banks/x.md", options);
		const question = must(parsed.questions[0], "应有题目");
		assertEqual(question.ok, false, "缺少数据块应降级");
		const messages = question.warnings.map((warning) => warning.message).join(" | ");
		assert(messages.includes("data block is missing"), `应是英文提示（实际：${messages}）`);
		assert(!/[\u4e00-\u9fff]/.test(messages), `英文提示里不应有中文（实际：${messages}）`);
	});
});

test("英文：题型名、默认标题与设置文案", async () => {
	await inLanguage("en", () => {
		assertEqual(typeLabel("single"), "Single choice", "题型名");
		assertEqual(typeLabel(null), "Unknown", "题型缺失");
		assertEqual(defaultTitles().blank, "Fill-in-the-blank stem", "默认题干标题");
		assertEqual(t("setting.language.name"), "Interface language", "设置项名称");
		assertEqual(t("command.openPractice"), "Open practice window", "命令名");
	});
});

test("英文：校验通知在单题与多题下都读得通", async () => {
	await inLanguage("en", () => {
		// 英文没有量词，计数必须放在标签后面，否则会出现 `1 questions` 这种错误说法。
		assertEqual(
			t("notice.validation", { total: 1, ok: 1, bad: 0 }),
			"Checked 1: 1 answerable, 0 need fixing.",
			"单题通知"
		);
		assertEqual(
			t("notice.validation", { total: 3, ok: 2, bad: 1 }),
			"Checked 3: 2 answerable, 1 need fixing.",
			"多题通知"
		);
		assertEqual(
			t("notice.validationFileWarnings", { total: 1, ok: 0, bad: 1, count: 1 }),
			"Checked 1: 0 answerable, 1 need fixing; file-level warnings: 1.",
			"带文件级提示的单题通知"
		);
	});
});

test("英文：五种题型的模板仍然能解析成可作答的题", async () => {
	await inLanguage("en", () => {
		for (const type of QUIZ_TYPES) {
			const markdown = buildQuestionTemplate({
				type,
				title: defaultTitles()[type],
				headingLevel: 2,
				blockLanguage: "quiz",
				blankMarker: "highlight",
			});
			const source = ["---", "quiz: true", "---", "", markdown, ""].join("\n");
			const question = must(
				parseQuizFile(source, `banks/${type}.md`, options).questions[0],
				`${type}：英文模板未解析出题目`
			);
			assertEqual(
				question.ok,
				true,
				`${type}：英文模板不应降级（${question.warnings.map((warning) => warning.message).join("；")}）`
			);
		}
	});
});

test("英文：加粗挖空标记的模板同样可作答", async () => {
	await inLanguage("en", () => {
		const markdown = buildQuestionTemplate({
			type: "blank",
			title: defaultTitles().blank,
			headingLevel: 2,
			blockLanguage: "quiz",
			blankMarker: "bold",
		});
		const source = ["---", "quiz: true", "---", "", markdown, ""].join("\n");
		// 解析设置必须与模板生成时一致，否则加粗标记不会被当成空位。
		const question = must(
			parseQuizFile(source, "banks/blank.md", { ...options, blankMarker: "bold" }).questions[0],
			"未解析出题目"
		);
		assertEqual(question.ok, true, "加粗挖空模板应可作答");
		assertEqual(question.blanks.length, 1, "应识别出一个空位");
	});
});

/**
 * 对话框里设置行上的按钮文案。
 *
 * obsidian 的 `Setting` 在测试里由存根顶替，按钮文字只存在控件对象上（不像真实
 * Obsidian 那样会写进 DOM），因此按存根的反向引用取回控件再读 `text`。
 */
function modalButtonText(modal: InsertQuestionModal): string {
	const settings = Array.from(modal.contentEl.querySelectorAll("div"))
		.map((el) => (el as unknown as { setting?: { components: unknown[] } }).setting)
		.filter((setting): setting is { components: unknown[] } => setting !== undefined);
	for (const setting of settings) {
		for (const component of setting.components) {
			if (component instanceof ButtonComponent) return component.text;
		}
	}
	throw new Error("对话框里找不到按钮");
}

test("英文：插入题目对话框与它给出的预览都是英文", async () => {
	await inLanguage("en", () => {
		const modal = new InsertQuestionModal({} as never, {
			headingLevel: 2,
			blockLanguage: "quiz",
			blankMarker: "highlight",
			onSubmit: () => undefined,
		});
		modal.open();

		assertEqual(modal.titleEl.textContent, "Insert question", "对话框标题");
		assertEqual(modalButtonText(modal), "Insert", "提交按钮");
		assert(
			(modal.contentEl.textContent ?? "").includes("Preview"),
			`对话框应显示英文预览标签（实际：${modal.contentEl.textContent}）`
		);

		const preview = modal.contentEl.querySelector("pre")?.textContent ?? "";
		assert(preview.includes("Single choice stem"), `预览应使用英文默认标题（实际：${preview}）`);
		assert(preview.includes("Option text ^a"), "预览应包含英文占位选项");
		assert(!/[\u4e00-\u9fff]/.test(preview), `英文预览不应有中文（实际：${preview}）`);
		modal.close();
	});
});

// ---------------------------------------------------------------------------
// 英文界面的刷题窗口
// ---------------------------------------------------------------------------

const BANK = [
	"---",
	"quiz: true",
	"---",
	"",
	"## Bank question",
	"",
	"- One ^a",
	"- Two ^b",
	"",
	"```quiz",
	"id: q1",
	"type: single",
	"answer: a",
	"```",
].join("\n");

function buildView(): PracticeView {
	const file = { path: "banks/net.md", basename: "net", stat: { mtime: 0 } };
	const parsed = parseQuizFile(BANK, file.path, options);
	const service = {
		listQuizFiles: () => [file],
		parseFile: async () => parsed,
		fileAtPath: () => file,
		isQuizFile: () => true,
		updateSettings: () => undefined,
		submit: async () => ({ correct: true, details: [], recorded: [] }),
	};
	const host: EasyQuizHost = {
		settings: {
			language: "en",
			blockLanguage: "quiz",
			headingLevels: [2, 2],
			blankMarker: "highlight",
			pathGlobs: [],
			historyLimit: 10,
			writeBackEnabled: true,
		},
		service: service as unknown as EasyQuizHost["service"],
	};
	return new PracticeView({ app: {} } as never, host, () => undefined);
}

/** 按 `data-action` 找窗口上的按钮。 */
function action(view: PracticeView, name: string): HTMLElement {
	const el = view.contentEl.querySelector<HTMLElement>(`button[data-action='${name}']`);
	return must(el ?? undefined, `缺少按钮：${name}`);
}

function click(el: HTMLElement): void {
	el.dispatchEvent(new testWindow.MouseEvent("click", { bubbles: true }));
}

test("英文：刷题窗口的列表页与勾选按钮", async () => {
	await inLanguage("en", async () => {
		const view = buildView();
		assertEqual(view.getDisplayText(), "Practice", "视图标题");
		await view.activate();
		const text = view.contentEl.textContent ?? "";
		assert(text.includes("Question-bank files"), `应显示英文列表标题（实际：${text}）`);
		assert(text.includes("Question-bank files: 1"), "应汇总文件数");
		assert(text.includes("Questions: 1"), "应汇总题量");
		assert(text.includes("Select all answerable"), "全选按钮应为英文");
		assert(text.includes("Set up practice (0 selected)"), "开始设置按钮应为英文");
		assert(!/[\u4e00-\u9fff]/.test(text), `英文界面不应有中文（实际：${text}）`);
	});
});

test("英文：走完刷题窗口的三个页面，全程没有中文", async () => {
	await inLanguage("en", async () => {
		const view = buildView();
		await view.activate();

		// 列表页 → 设置页
		click(action(view, "pick-file-only"));
		await flush();
		assert((view.contentEl.textContent ?? "").includes("Practice settings"), "应进入刷题设置页");

		// 设置页 → 刷题页
		click(action(view, "start-session"));
		await flush();
		const sessionText = view.contentEl.textContent ?? "";
		assert(sessionText.includes("Question 1 of 1"), `应显示英文进度（实际：${sessionText}）`);
		assert(sessionText.includes("Start practice") === false, "进入刷题页后不该还停在设置页");

		// 作答并提交
		const option = must(
			view.contentEl.querySelector<HTMLElement>(".easy-quiz-card__option") ?? undefined,
			"缺少选项"
		);
		click(option);
		click(
			must(
				view.contentEl.querySelector<HTMLElement>(".easy-quiz-card__actions button") ?? undefined,
				"缺少提交按钮"
			)
		);
		await flush();
		assert((view.contentEl.textContent ?? "").includes("Correct"), "应显示英文对错反馈");

		// 最后一题 → 成绩单
		click(action(view, "next-question"));
		await flush();
		const text = view.contentEl.textContent ?? "";
		assert(text.includes("Round results"), `应显示英文成绩单（实际：${text}）`);
		assert(text.includes("Practise again"), "成绩单按钮应为英文");
		assert(!/[\u4e00-\u9fff]/.test(text), `英文界面不应有中文（实际：${text}）`);
	});
});

test("英文：切到中文后同一个窗口重画为中文", async () => {
	await inLanguage("en", async () => {
		const view = buildView();
		await view.activate();
		assert((view.contentEl.textContent ?? "").includes("Question-bank files"), "先渲染英文");

		// 窗口每次 render 都重新取文案，因此切换语言后重画即可生效。
		setLanguage("zh");
		await view.render();
		const text = view.contentEl.textContent ?? "";
		assert(text.includes("题库文件"), `重画后应为中文（实际：${text}）`);
		assert(text.includes("全选可作答"), "按钮也应为中文");
	});
});

test("中文：同一批文案仍是原来的中文（没有被英文改动带偏）", async () => {
	await inLanguage("zh", () => {
		assertEqual(typeLabel("blank"), "填空", "题型名");
		assertEqual(defaultTitles().single, "单选题干", "默认题干标题");
		assertEqual(t("practice.toolbar.selectAll"), "全选可作答", "全选按钮");
		assertEqual(t("card.feedback.correct"), "回答正确", "对错反馈");
		assertEqual(at([t("stats.untried")], 0), "未作答", "角标");
	});
});
