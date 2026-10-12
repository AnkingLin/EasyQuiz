/**
 * 运行全部测试：esbuild 打包成单文件后由 node 执行。
 */

import { results, test } from "./harness";
import * as parserTests from "./quiz-parser.test";
import * as gradeWriteBackTests from "./quiz-grading.test";
import * as stemTests from "./quiz-stem.test";
import * as matchBoardTests from "./quiz-match-board.test";
import * as matchDomTests from "./quiz-match-dom.test";

export { test };

const summary = results();
void parserTests;
void gradeWriteBackTests;
void stemTests;
void matchBoardTests;
void matchDomTests;

for (const failure of summary.failures) {
	console.error(`✗ ${failure}`);
}
console.log(`\n通过 ${summary.passed} 项，失败 ${summary.failures.length} 项`);
if (summary.failures.length > 0) process.exit(1);
console.log("全部通过。");
