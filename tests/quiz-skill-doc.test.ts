/**
 * 知识点写作规范（skills/easyquiz-authoring/SKILL.md）的自检。
 *
 * 规范里的示例必须真的能作答：文档一旦写出一个解析不了的骨架，读者会照着抄进去。
 * 这里直接读规范文件，抽出一级 ````markdown 围栏里的示例，交给真实解析器与判分逻辑验证。
 * 因此规范里的示例既是文档，也是测试数据。
 */

import * as yaml from "js-yaml";
import { contentHash } from "../src/hash";
import { gradeAnswer } from "../src/grade";
import { parseQuizFile, ParseOptions } from "../src/parser";
import { QuizQuestion } from "../src/types";
import skill from "../skills/easyquiz-authoring/SKILL.md";
import { assert, assertEqual, at, must, test } from "./harness";

const options: ParseOptions = {
	deps: { parseYaml: (source) => yaml.load(source), hash: contentHash },
};

/**
 * 抽取规范里的题目示例。
 *
 * 示例用 `<!-- example:start -->` / `<!-- example:end -->` 标注，示例本身是
 * 「外层 ````markdown 围栏 + 内层 ```quiz 数据块」的嵌套代码块。
 * 抽取时按行去掉最外层围栏，内层围栏与示例正文原样保留。
 */
const EXAMPLE_START = "<!-- example:start -->";
const EXAMPLE_END = "<!-- example:end -->";

function extractExamples(): string[] {
	const lines = skill.replace(/\r\n?/g, "\n").split("\n");
	const examples: string[] = [];
	for (let i = 0; i < lines.length; i++) {
		if ((lines[i] ?? "").trim() !== EXAMPLE_START) continue;
		let end = -1;
		for (let n = i + 1; n < lines.length; n++) {
			if ((lines[n] ?? "").trim() === EXAMPLE_END) {
				end = n;
				break;
			}
		}
		assert(end > i, `第 ${i + 1} 行的 ${EXAMPLE_START} 没有对应的 ${EXAMPLE_END}`);

		const block = lines.slice(i + 1, end);
		// 最外层围栏：第一行是带语言串的围栏，最后一行是只有反引号的围栏。
		const first = block.findIndex((line) => line.trim() !== "");
		assert(first >= 0 && /^[ \t]*`{4,}[ \t]*\S+[ \t]*$/.test(block[first] ?? ""), `第 ${i + 1} 行的示例应以 \`\`\`\`markdown 围栏开头`);
		let last = block.length - 1;
		while (last > first && (block[last] ?? "").trim() === "") last--;
		assert(/^[ \t]*`{4,}[ \t]*$/.test(block[last] ?? ""), `第 ${i + 1} 行的示例应以 \`\`\`\` 围栏结尾`);

		const markdown = block.slice(first + 1, last).join("\n");
		assert(markdown.includes("```quiz"), `第 ${i + 1} 行的示例里没有 \`\`\`quiz 数据块`);
		examples.push(markdown);
		i = end;
	}
	return examples;
}

/** 示例放进一份完整的题库文件里解析，取第一道题。 */
function parseExample(markdown: string): { question: QuizQuestion; path: string } {
	// 去掉示例内层围栏前的缩进，再把示例放进一份完整的题库文件里解析。
	const dedented = dedent(markdown);
	const source = ["---", "quiz: true", "---", "", dedented, ""].join("\n");
	const path = "题库/规范示例.md";
	const parsed = parseQuizFile(source, path, { ...options, headingLevels: [2, 4] });
	return { question: at(parsed.questions, 0, `示例未解析出题目：\n${dedented}`), path };
}

/** 去掉每行公共的前导空白，让带缩进的示例也能被当作顶层正文解析。 */
function dedent(text: string): string {
	const lines = text.split("\n");
	const indents = lines
		.filter((line) => line.trim() !== "")
		.map((line) => /^[ \t]*/.exec(line)?.[0].length ?? 0);
	const common = Math.min(...indents);
	if (!Number.isFinite(common) || common === 0) return text;
	return lines.map((line) => line.slice(common)).join("\n");
}

function warnCodes(question: QuizQuestion): string {
	return question.warnings.map((warning) => warning.code).join(",");
}

const examples = extractExamples();

test("规范里的每个题目示例都能被解析成可作答的题", () => {
	assert(examples.length >= 5, `规范里应至少给出 5 个题目示例，实际 ${examples.length} 个`);
	for (const markdown of examples) {
		const { question } = parseExample(markdown);
		assertEqual(question.ok, true, `示例不可作答（warnings=${warnCodes(question)}）：\n${markdown}`);
	}
});

test("规范里的题目示例都写了知识点链接，且链接不会跑进题面标题", () => {
	for (const markdown of examples) {
		const { question } = parseExample(markdown);
		assert(question.knowledgeLink !== null, `示例缺少 ^[[知识点]] 链接：\n${markdown}`);
		assert(!question.title.includes("[["), `题面标题不应带链接（实际：${question.title}）`);
	}
});

test("规范里的单选题示例答案能判对", () => {
	const single = must(
		examples.find((markdown) => markdown.includes("type: single")),
		"规范里应有单选题示例"
	);
	const { question } = parseExample(single);
	const result = gradeAnswer(question, { kind: "choice", anchors: ["c"] });
	assertEqual(result.correct, true, `示例单选题的答案 c 应判对：\n${single}`);
});

test("规范里的填空题示例能用 accept 规则判对", () => {
	const blank = must(
		examples.find((markdown) => markdown.includes("type: blank") && markdown.includes("==20==")),
		"规范里应有 TCP 首部填空题示例"
	);
	const { question } = parseExample(blank);
	const result = gradeAnswer(question, { kind: "blank", values: ["20", "序号"] });
	assertEqual(result.correct, true, `示例填空题的 20 / 序号 应判对：\n${blank}`);
});

/**
 * 「一个条目对多个条目负责时重复写行」是配对题里最容易写错的一条：作者很容易以为
 * 一格能塞多个条目（旧写法用 ` / ` 分隔）。规范里的配对示例必须证明重复行确实会合并，
 * 且合并后的节点要连出全部连线才判对。
 */
test("规范里的配对示例用重复行表达一个条目对多个条目负责", () => {
	const match = must(
		examples.find((markdown) => markdown.includes("type: match") && markdown.includes("| PostgreSQL | 关系型 |")),
		"规范里应有「重复行」写法的配对示例"
	);
	const { question } = parseExample(match);
	const left = question.board[0]?.items.map((item) => item.text) ?? [];
	const right = question.board[1]?.items.map((item) => item.text) ?? [];
	assertEqual(right.join(","), "关系型,键值型", `答案列应去重合并（实际：${right.join(",")}）`);
	assertEqual(left.length, 3, `首列应有三个条目（实际：${left.join(",")}）`);

	// 合并后的「关系型」挂着两条线，一条不少才算全对。
	assertEqual(question.boardPairs.length, 3, "两行共用「关系型」，共三条连线");
	const all = question.boardPairs.map((pair) => ({ left: pair.left, right: pair.right }));
	assertEqual(gradeAnswer(question, { kind: "match", pairs: all }).correct, true, "三条都连上应判对");
	assertEqual(
		gradeAnswer(question, { kind: "match", pairs: all.slice(0, 2) }).correct,
		false,
		"少连一条应判错"
	);
});

test("规范说明一格就是一个条目，斜杠不是分隔符", () => {
	assert(
		skill.includes("one cell is one entry"),
		"规范应明确写出「一个单元格就是一个条目」"
	);
	assert(
		skill.includes("`MySQL / PostgreSQL` is a single item"),
		"规范应举例说明斜杠不会被拆分成多个条目"
	);
});

/**
 * 「空位必须写在题面标题下面」是规范里最容易写错的一条，这里把它钉住：
 * 规范必须明确写出这条要求，而且标记留在标题行上确实解析不出空位。
 */
test("规范要求填空内容写在标题下方，并说明留在标题行会降级", () => {
	assert(
		skill.includes("never in the heading itself"),
		"规范应明确写出「空位不能写在标题行上」"
	);
	assert(
		skill.includes("type: blank` needs a blank"),
		"规范应说明标记留在标题行会得到 blankNoMarker 降级提示"
	);

	const headingAsStem = [
		"---",
		"quiz: true",
		"---",
		"",
		"## 慢性肝淤血时肝窦的 ==淤血扩张== ^[[[病理学/局部血液循环障碍#右心衰致肝淤血]]]",
		"",
		"```quiz",
		"type: blank",
		"```",
	].join("\n");
	const parsed = parseQuizFile(headingAsStem, "题库/测试.md", options);
	const question = must(parsed.questions[0], "应解析出题目");

	assertEqual(question.blanks.length, 0, "标题行上的标记不应算作空位");
	assertEqual(question.ok, false, "没有空位时应降级");
	assert(
		question.warnings.some((warning) => warning.message.includes("==答案== ^锚点")),
		`降级提示应说明需要 ==答案== ^锚点（实际：${warnCodes(question)}）`
	);
});
