/**
 * 极简断言框架：测试结果由各测试文件返回，统一由 tests/run.ts 汇总。
 */

let passed = 0;
const failures: string[] = [];

export function test(name: string, fn: () => void): void {
	try {
		fn();
		passed++;
	} catch (error) {
		failures.push(`${name}\n    ${error instanceof Error ? error.message : String(error)}`);
	}
}

export function assert(condition: unknown, message: string): void {
	if (!condition) throw new Error(message);
}

export function assertEqual<T>(actual: T, expected: T, message: string): void {
	if (actual !== expected) {
		throw new Error(`${message}：期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`);
	}
}

export function results(): { passed: number; failures: string[] } {
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
