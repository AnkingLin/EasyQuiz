/**
 * 连线题板的纯逻辑与状态机（不依赖 obsidian，因此可以直接测试）。
 *
 * 节点 key 直接使用题板条目的 key（如 `i0.abcd`），条目本身带列号，
 * 因此判断"是否相邻列"不需要额外编码。
 *
 * 交互规则：
 *   - 只允许**相邻两列**之间连线（第 1↔2、2↔3…），跨列连线一律拒绝。
 *   - 方向无关：从左往右点与从右往左点得到同一条线。
 *   - 点击相邻两列的条目 = **按这一条线切换**：没有就建立，已有就删除。
 *     因此一个条目可以同时连多条线：同列同文本的条目合并成一个节点后，
 *     它在正确答案里本来就挂着多条线（见 `parser.ts` 的 `itemFor` 去重，
 *     重复表格行是"一个条目对多个条目负责"的唯一写法），
 *     而判分要求一条不多一条不少（`grade.ts` 的 `gradeMatch`）。
 *   - "取消连接"就是这个手势的反面，不需要修饰键、长按或额外模式；
 *     改连 = 先删旧线、再连新线。
 *   - 重复点击**同一个**节点只是取消选中，不会静默删线。
 */

import { BoardItem, BoardPair } from "./types";

/** 两个条目的有序 key 对（列号小在前）。 */
export function orderedPair(first: BoardItem, second: BoardItem): [string, string] {
	return first.column <= second.column ? [first.key, second.key] : [second.key, first.key];
}

/**
 * 构造连线 key：`左key~右key`（列号小在前）。
 *
 * 方向无关：参数顺序不影响结果。
 * 只允许相邻列，因此同列或相隔一列以上都返回 null。
 */
export function makeConnection(first: BoardItem, second: BoardItem): string | null {
	if (first.column === second.column) return null;
	const [leftItem, rightItem] = first.column < second.column ? [first, second] : [second, first];
	// 只允许相邻列。
	if (rightItem.column - leftItem.column !== 1) return null;
	return `${leftItem.key}~${rightItem.key}`;
}

/** 拆出 `[左key, 右key]`；格式不符时返回 `[null, null]`。 */
export function splitConnection(connection: string): [string | null, string | null] {
	const separator = connection.indexOf("~");
	if (separator <= 0) return [null, null];
	return [connection.slice(0, separator), connection.slice(separator + 1)];
}

/** 返回涉及某条目的所有连线。 */
export function connectionsOf(connections: Iterable<string>, itemKey: string): string[] {
	const result: string[] = [];
	for (const connection of connections) {
		const [left, right] = splitConnection(connection);
		if (left === itemKey || right === itemKey) result.push(connection);
	}
	return result;
}

export interface BoardView {
	connections: string[];
	activeKey: string | null;
}

export interface BoardState {
	click: (itemKey: string) => boolean;
	/** 删除一条连线（点击已画出的连线时使用）。返回该连线此前是否存在。 */
	remove: (connection: string) => boolean;
	view: () => BoardView;
	/** 提交用的连线列表（key 为 `左key~右key`）。 */
	pairs: () => BoardPair[];
}

/**
 * 创建题板状态机。
 *
 * @param items 题板上的全部条目（需带 `column`）。
 */
export function createBoardState(items: BoardItem[]): BoardState {
	const itemAt = new Map<string, BoardItem>();
	for (const item of items) itemAt.set(item.key, item);

	/** 条目 key → 与它相连的连线（一个条目可以有多条，故用 Set）。 */
	const byItem = new Map<string, Set<string>>();
	/** 一条连线 → 两端条目 key。 */
	const endpoints = new Map<string, [string, string]>();
	let activeKey: string | null = null;

	const linksOf = (itemKey: string): Set<string> => {
		const existing = byItem.get(itemKey);
		if (existing !== undefined) return existing;
		const created = new Set<string>();
		byItem.set(itemKey, created);
		return created;
	};

	function addConnection(connection: string, first: string, second: string): void {
		const firstItem = itemAt.get(first);
		const secondItem = itemAt.get(second);
		const ends: [string, string] =
			firstItem !== undefined && secondItem !== undefined ? orderedPair(firstItem, secondItem) : [first, second];
		endpoints.set(connection, ends);
		linksOf(first).add(connection);
		linksOf(second).add(connection);
	}

	/**
	 * 建立一条连线。
	 *
	 * **不做任何"替换"推断**：同一条目在同一对相邻列里可以连多条，
	 * 因为合并后的条目在正确答案里可能要对多个条目负责。
	 * 是否覆盖旧线由玩家显式决定（先删再连），不猜测意图。
	 */
	function connect(firstKey: string, secondKey: string): boolean {
		const a = itemAt.get(firstKey);
		const b = itemAt.get(secondKey);
		if (a === undefined || b === undefined) return false;
		const connection = makeConnection(a, b);
		if (connection === null) return false;
		addConnection(connection, firstKey, secondKey);
		return true;
	}

	/**
	 * 删除一条连线。
	 *
	 * 必须**两端都删**：中间列的条目可以同时连左右两侧，
	 * 只删一端会在另一端留下查不到的悬挂连线。
	 */
	function disconnect(connection: string): boolean {
		const ends = endpoints.get(connection);
		if (ends === undefined) return false;
		endpoints.delete(connection);
		for (const end of ends) {
			const links = byItem.get(end);
			if (links === undefined) continue;
			links.delete(connection);
			if (links.size === 0) byItem.delete(end);
		}
		return true;
	}

	return {
		click(itemKey: string): boolean {
			const item = itemAt.get(itemKey);
			if (item === undefined) return false;

			// 没有选中项：选中它。再次点击选中项本身：取消选中（不删线）。
			if (activeKey === null || activeKey === itemKey) {
				activeKey = activeKey === itemKey ? null : itemKey;
				return true;
			}

			const first = itemAt.get(activeKey);
			if (first === undefined) {
				activeKey = itemKey;
				return true;
			}

			const connection = makeConnection(first, item);
			if (connection === null) {
				// 同列或跨列：不成线，改为选中新点中的条目。
				activeKey = itemKey;
				return true;
			}

			// 同一对条目再点一次 = 取消这条连线；否则建立新线。
			if (endpoints.has(connection)) disconnect(connection);
			else connect(activeKey, itemKey);
			activeKey = null;
			return true;
		},

		remove(connection: string): boolean {
			return disconnect(connection);
		},

		view(): BoardView {
			return { connections: [...endpoints.keys()], activeKey };
		},

		pairs(): BoardPair[] {
			return [...endpoints.values()].map((ends) => ({ left: ends[0], right: ends[1] }));
		},
	};
}
