/**
 * 连线题板的纯逻辑（不依赖 obsidian，因此可以直接测试）。
 *
 * 节点 key 采用带前缀的形式，避免"左侧条目的文本"和"右侧答案的文本"恰好相同时互相冲突：
 *   - 左节点：`L|条目key`
 *   - 右节点：`R|列号|答案文本`
 * 一条连线存成 `L|条目key|R|列号|答案文本`。
 */

export const LEFT_PREFIX = "L|";
export const RIGHT_PREFIX = "R|";

export function leftNodeKey(entryKey: string): string {
	return `${LEFT_PREFIX}${entryKey}`;
}

export function rightNodeKey(columnIndex: number, answer: string): string {
	return `${RIGHT_PREFIX}${columnIndex}|${answer}`;
}

export function isLeftKey(key: string): boolean {
	return key.startsWith(LEFT_PREFIX);
}

/** 把两个节点归一化成 `[左, 右]`；同侧时返回 `[null, null]`。 */
export function orderPair(first: string, second: string): [string | null, string | null] {
	if (isLeftKey(first) && !isLeftKey(second)) return [first, second];
	if (!isLeftKey(first) && isLeftKey(second)) return [second, first];
	return [null, null];
}

/**
 * 构造连线字符串。左右节点给出顺序任意，同侧时返回 null。
 */
export function makeConnection(first: string, second: string): string | null {
	const [left, right] = orderPair(first, second);
	return left === null || right === null ? null : `${left}|${right}`;
}

/** 拆出 `[左节点key, 右节点key]`；格式不符时返回 `[null, null]`。 */
export function splitConnection(connection: string): [string | null, string | null] {
	const parts = connection.split("|");
	// 结构为 L | 条目key | R | 列号 | 答案文本
	// 注意 `R` 在下标 2（右节点 key 自身以 `R|` 开头）。
	if (parts.length < 5 || parts[0] !== "L" || parts[2] !== "R") return [null, null];
	return [`${parts[0]}|${parts[1]}`, parts.slice(2).join("|")];
}

/** 返回涉及某节点 key 的所有连线。 */
export function connectionsOf(connections: Iterable<string>, nodeKey: string): string[] {
	const result: string[] = [];
	for (const connection of connections) {
		const [left, right] = splitConnection(connection);
		if (left === nodeKey || right === nodeKey) result.push(connection);
	}
	return result;
}

/** 从右节点 key 还原答案文本。 */
export function answerOf(rightNodeKeyValue: string): string {
	if (!rightNodeKeyValue.startsWith(RIGHT_PREFIX)) return "";
	// R|列号|答案 → 去掉前缀与列号
	return rightNodeKeyValue.split("|").slice(2).join("|");
}

/** 从左节点 key 还原条目 key。 */
export function entryKeyOf(leftNodeKeyValue: string): string {
	return leftNodeKeyValue.startsWith(LEFT_PREFIX) ? leftNodeKeyValue.slice(LEFT_PREFIX.length) : "";
}
