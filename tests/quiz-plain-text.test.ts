/**
 * 显示用纯文本（`plainText`）的测试。
 *
 * 这个函数存在的唯一理由是「`~` 消失」这个 bug 的另一半：题卡上的选项已经按 Markdown
 * 渲染了，但复盘列表、判分提示只放得下一行纯文本，不能渲染 Markdown。早先那些地方
 * 复用了**为匹配而写**的 `normalizeText`（它会删掉 `* _ ` ~`），于是卡片上写着
 * `H~2~O`、提示里却是 `H2O`。
 *
 * 因此这里有两条同等重要的断言方向：
 *   1. 单独出现的 `~`、`_` 必须保留（它们是学科符号，不是标记）；
 *   2. 成对的真标记（`**粗体**`、`~~删除线~~`、行内代码…）必须剥掉，不留残渣。
 */

import * as yaml from "js-yaml";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { contentHash } from "../src/hash";
import { plainText } from "../src/plain-text";
import { gradeAnswer } from "../src/grade";
import { assert, assertEqual, test } from "./harness";

const options: ParseOptions = { deps: { parseYaml: (s) => yaml.load(s), hash: contentHash } };

// ---------------------------------------------------------------------------
// 保留：单独的 ~ 与 _
// ---------------------------------------------------------------------------

test("纯文本：单独的 ~ 原样保留（下标写法不会被吃掉）", () => {
	assertEqual(plainText("H~2~O"), "H~2~O", "化学式里的 ~ 必须留下");
	assertEqual(plainText("约 ~5%"), "约 ~5%", "约数里的 ~ 必须留下");
	assertEqual(plainText("~/.config"), "~/.config", "路径里的 ~ 必须留下");
	assertEqual(plainText("a~b~c"), "a~b~c", "交替出现的单个 ~ 也留下");
});

test("纯文本：单独的下划线原样保留（标识符不会被吃掉）", () => {
	assertEqual(plainText("snake_case_name"), "snake_case_name", "下划线是标识符的一部分");
	assertEqual(plainText("__init__"), "__init__", "双下划线不是成对标记的加粗");
});

// ---------------------------------------------------------------------------
// 剥掉：成对的真标记
// ---------------------------------------------------------------------------

test("纯文本：成对的 Markdown 标记会被剥掉", () => {
	assertEqual(plainText("**加粗**"), "加粗", "加粗");
	assertEqual(plainText("*斜体*"), "斜体", "斜体");
	assertEqual(plainText("~~删除线~~"), "删除线", "删除线");
	assertEqual(plainText("==高亮=="), "高亮", "高亮");
	assertEqual(plainText("`代码`"), "代码", "行内代码");
	assertEqual(plainText("普通 **粗** 混排"), "普通 粗 混排", "混排只剥标记");
});

test("纯文本：删除线剥掉后不会误伤旁边的单个 ~", () => {
	// 这条最容易被正则写坏：剥 `~~…~~` 的规则不能把 `H~2~O` 里的 `~2~` 也当成一对。
	assertEqual(plainText("~~旧的~~ H~2~O"), "旧的 H~2~O", "删除线剥掉，化学式保留");
	assertEqual(plainText("H~2~O 和 ~~删除~~"), "H~2~O 和 删除", "顺序反过来也一样");
});

test("纯文本：链接只留下可读的文字", () => {
	assertEqual(plainText("[[目标笔记]]"), "目标笔记", "双链留下目标名");
	assertEqual(plainText("[[目标笔记|显示文字]]"), "显示文字", "带别名时留下别名");
	assertEqual(plainText("[显示文字](https://example.com)"), "显示文字", "普通链接留下文字");
});

test("纯文本：空白会被折叠并去掉两端", () => {
	assertEqual(plainText("  两边有空白  "), "两边有空白", "去掉两端空白");
	assertEqual(plainText("多   个   空格"), "多 个 空格", "折叠连续空白");
	assertEqual(plainText("换\n行"), "换 行", "换行折叠成空格");
});

test("纯文本：空串与纯空白得到空串", () => {
	assertEqual(plainText(""), "", "空串");
	assertEqual(plainText("   "), "", "纯空白");
});

// ---------------------------------------------------------------------------
// 与判分提示的衔接
// ---------------------------------------------------------------------------

/** 一道答案里带 `~` 的单选题。 */
const TILDE = [
	"---",
	"quiz: true",
	"---",
	"",
	"## 水的化学式",
	"",
	"- H~2~O ^a",
	"- CO~2~ ^b",
	"",
	"```quiz",
	"type: single",
	"answer: a",
	"```",
].join("\n");

test("纯文本：判分提示里写出的选项文字保留 ~，与卡片上看到的一致", () => {
	const parsed = parseQuizFile(TILDE, "题库/化学.md", options);
	const question = parsed.questions[0];
	if (question === undefined) throw new Error("应解析出题目");

	// 答错时，提示会写出「正确选项是 a（H~2~O）」。这里断言那行文字里的 `~` 还在。
	// 选择题的作答 kind 是 `"choice"`（single 与 multi 共用，由题目的 type 决定判分分支）。
	const result = gradeAnswer(question, { kind: "choice", anchors: ["b"] });
	assertEqual(result.correct, false, "选 b 应判错");
	const text = result.details.map((detail) => detail.note ?? "").join("\n");
	assert(text.includes("H~2~O"), `判分提示应保留 ~（实际：${JSON.stringify(text)}）`);
});
