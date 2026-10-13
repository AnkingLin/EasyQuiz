/**
 * 运行全部测试：esbuild 打包成单文件后由 node 执行。
 *
 * 先 import 所有测试文件（此时只是注册用例），再统一运行，
 * 这样异步测试会被 await，失败也不会变成未捕获的 rejection。
 */

import { runTests } from "./harness";
import "./quiz-parser.test";
import "./quiz-grading.test";
import "./quiz-stem.test";
import "./quiz-match-board.test";
import "./quiz-insert.test";
import "./quiz-insert-modal.test";
import "./quiz-match-dom.test";
import "./quiz-knowledge-link.test";
import "./quiz-session.test";
import "./quiz-practice-view.test";
import "./quiz-skill-doc.test";
import "./quiz-i18n.test";

async function main(): Promise<void> {
	const summary = await runTests();

	for (const failure of summary.failures) {
		console.error(`✗ ${failure}`);
	}
	console.log(`\n通过 ${summary.passed} 项，失败 ${summary.failures.length} 项`);
	if (summary.failures.length > 0) process.exit(1);
	console.log("全部通过。");
}

void main();
