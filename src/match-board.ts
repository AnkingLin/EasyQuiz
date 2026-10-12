/**
 * 连线题板的纯逻辑与状态机（不依赖 obsidian，因此可以直接测试）。
 *
 * 节点 key：
 *   - 左节点：`L|条目key`
 *   - 右节点：`R|列号|答案文本`
 * 一条连线存成 `L|条目key|R|列号|答案文本`。
 *
 * 交互规则（都在 {@link createBoardState} 里实现并被测试覆盖）：
 *   - 只有"左 → 右"能连线；同侧点击只是切换选中。
 *   - 一个右节点在**它所属的列**里只能被连一次；连到别的条目时，旧连线在新连线建立之后才解除。
 *   - 一个左条目在同一列里只保留一条连线；连到同列的另一个答案时同样先建后解。
 *   - 不允许跨列：右节点只能与"它所在列"的条目连线，由 `expectedColumn` 校验。
 */

export const LEFT_PREFIX = "L|";
export const RIGHT_PREFIX = "R|";

/** 左条目在某列里的连线标识：同一条目在不同列可以有各自的连线。 */
export function slotKey(entryKey: string, columnIndex: number): string {
	return `${entryKey}@${columnIndex}`;
}

export function leftNodeKey(entryKey: string): string {
	return `${LEFT_PREFIX}${entryKey}`;
}

export function rightNodeKey(columnIndex: number, answer: string): string {
	return `${RIGHT_PREFIX}${columnIndex}|${answer}`;
}

export function isLeftKey(key: string): boolean {
	return key.startsWith(LEFT_PREFIX);
}

/** 从左节点 key 还原条目 key。 */
export function entryKeyOf(leftNodeKeyValue: string): string {
	return leftNodeKeyValue.startsWith(LEFT_PREFIX) ? leftNodeKeyValue.slice(LEFT_PREFIX.length) : "";
}

/** 从右节点 key 还原答案文本（答案本身可能含 `|`）。 */
export function answerOf(rightNodeKeyValue: string): string {
	if (!rightNodeKeyValue.startsWith(RIGHT_PREFIX)) return "";
	const rest = rightNodeKeyValue.slice(RIGHT_PREFIX.length);
	const separator = rest.indexOf("|");
	return separator < 0 ? "" : rest.slice(separator + 1);
}

/** 从右节点 key 还原列号；非法时返回 -1。 */
export function columnOf(rightNodeKeyValue: string): number {
	if (!rightNodeKeyValue.startsWith(RIGHT_PREFIX)) return -1;
	const rest = rightNodeKeyValue.slice(RIGHT_PREFIX.length);
	const separator = rest.indexOf("|");
	if (separator < 0) return -1;
	const value = Number.parseInt(rest.slice(0, separator), 10);
	return Number.isFinite(value) ? value : -1;
}

/** 把两个节点归一化成 `[左, 右]`；同侧时返回 `[null, null]`。 */
export function orderPair(first: string, second: string): [string | null, string | null] {
	if (isLeftKey(first) && !isLeftKey(second)) return [first, second];
	if (!isLeftKey(first) && isLeftKey(second)) return [second, first];
	return [null, null];
}

/**
 * 构造连线字符串。左右节点给出顺序任意，同侧时返回 null。
 *
 * 若给出 `expectedColumn`，则要求右节点属于该列，否则返回 null（防止跨列连线）。
 */
export function makeConnection(
	first: string,
	second: string,
	expectedColumn?: number
): string | null {
	const [left, right] = orderPair(first, second);
	if (left === null || right === null) return null;
	if (expectedColumn !== undefined && columnOf(right) !== expectedColumn) return null;
	return `${left}|${right}`;
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

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

export interface BoardNode {
	key: string;
	/** 左节点为 null；右节点为它所属的答案列号。 */
	column: number | null;
}

export interface BoardView {
	connections: string[];
	activeKey: string | null;
	/** 当前正在作答的列号；未开始时为 null。 */
	activeColumn: number | null;
}

export interface BoardState {
	/** 点击某节点。返回是否有变化（供调用方决定是否重绘）。 */
	click: (nodeKey: string) => boolean;
	view: () => BoardView;
	/** 提交用的连线列表（只包含合法的左-右配对）。 */
	pairs: () => { key: string; target: string }[];
}

/**
 * 创建一个题板状态机。
 *
 * @param nodes 全部节点（左节点与右节点），key 必须唯一。
 */
export function createBoardState(nodes: BoardNode[]): BoardState {
	const nodeAt = new Map<string, BoardNode>();
	for (const node of nodes) nodeAt.set(node.key, node);

	/** 槽位（条目@列）→ 连线串。 */
	const bySlot = new Map<string, string>();
	/** 右节点 key → 连线串。 */
	const byRight = new Map<string, string>();
	let activeKey: string | null = null;
	let activeColumn: number | null = null;

	function connect(leftKey: string, rightKey: string): boolean {
		const connection = makeConnection(leftKey, rightKey);
		if (connection === null) return false;
		const [left, right] = splitConnection(connection);
		if (left === null || right === null) return false;
		const column = columnOf(right);
		const entryKey = entryKeyOf(left);
		const slot = slotKey(entryKey, column);

		// 先建立新连线，再解除被它取代的旧连线（避免出现"什么都没连"的中间状态）。
		const replaced = new Set(
			[bySlot.get(slot), byRight.get(right)].filter((value): value is string => value !== undefined)
		);
		bySlot.set(slot, connection);
		byRight.set(right, connection);

		for (const old of replaced) {
			if (old === connection) continue;
			const [oldLeft, oldRight] = splitConnection(old);
			if (oldLeft === null || oldRight === null) continue;
			const oldColumn = columnOf(oldRight);
			const oldSlot = slotKey(entryKeyOf(oldLeft), oldColumn);
			// 只清理仍指向这条旧连线的槽位，否则会误删刚建立的新连线。
			if (bySlot.get(oldSlot) === old) bySlot.delete(oldSlot);
			if (byRight.get(oldRight) === old) byRight.delete(oldRight);
		}
		return true;
	}

	return {
		click(nodeKey: string): boolean {
			const node = nodeAt.get(nodeKey);
			if (node === undefined) return false;

			if (activeKey === null || activeKey === nodeKey) {
				// 没有待配对的左条目：点击只是选中/取消选中（不删连线）。
				activeKey = activeKey === nodeKey ? null : nodeKey;
				if (activeKey !== null && node.column !== null) activeColumn = node.column;
				return true;
			}

			if (isLeftKey(activeKey) === isLeftKey(nodeKey)) {
				// 同侧：切换选中项。
				activeKey = nodeKey;
				if (node.column !== null) activeColumn = node.column;
				return true;
			}

			const applied = connect(activeKey, nodeKey);
			if (!applied) {
				activeKey = nodeKey;
				return true;
			}
			activeKey = null;
			if (node.column !== null) activeColumn = node.column;
			return true;
		},

		view(): BoardView {
			return {
				connections: [...new Set([...bySlot.values()])],
				activeKey,
				activeColumn,
			};
		},

		pairs(): { key: string; target: string }[] {
			const result: { key: string; target: string }[] = [];
			for (const connection of bySlot.values()) {
				const [left, right] = splitConnection(connection);
				if (left === null || right === null) continue;
				result.push({ key: entryKeyOf(left), target: answerOf(right) });
			}
			return result;
		},
	};
}
