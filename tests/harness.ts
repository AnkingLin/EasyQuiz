/**
 * 极简测试框架。
 *
 * 测试先注册、后统一运行（`runTests`），因此可以 await 异步测试，
 * 也能保证执行顺序稳定（DOM 测试依赖这一点）。
 */

import { setLanguage } from "../src/i18n";

/**
 * 测试统一用中文跑。
 *
 * 原因有两个：题库 fixture 与断言文案本来就是中文（界面文案与题面内容用的是同一套
 * 语言），以及中文是插件原有行为，这样每条断言仍在验证真实用得到的那份文案。
 * 英文由 `quiz-i18n.test.ts` 单独覆盖，它会在用例里显式切到 `en`。
 */
setLanguage("zh");

let passed = 0;
const failures: string[] = [];
const cases: { name: string; fn: () => void | Promise<void> }[] = [];

export function test(name: string, fn: () => void | Promise<void>): void {
	cases.push({ name, fn });
}

export function assert(condition: unknown, message: string): void {
	if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual !== expected) {
		throw new Error(`${message}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
	}
}

/** 依次运行已注册的测试。 */
export async function runTests(): Promise<{ passed: number; failures: string[] }> {
	for (const item of cases) {
		try {
			await item.fn();
			passed++;
		} catch (error) {
			failures.push(`${item.name}\n    ${error instanceof Error ? error.message : String(error)}`);
		}
	}
	return { passed, failures };
}

/** 断言某处一定有值：没有就当作测试失败，避免把 undefined 当数据用。 */
export function must<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

/** 取数组中一定存在的一项。 */
export function at<T>(items: readonly T[], index: number, message = `缺少下标 ${index} 的元素`): T {
	return must(items[index], message);
}
