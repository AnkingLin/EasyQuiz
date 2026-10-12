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
		examples.find((markdown) => markdown.includes("type: blank")),
		"规范里应有填空题示例"
	);
	const { question } = parseExample(blank);
	const result = gradeAnswer(question, { kind: "blank", values: ["20", "序号"] });
	assertEqual(result.correct, true, `示例填空题的 20 / 序号 应判对：\n${blank}`);
});
