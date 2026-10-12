/**
 * 连线题板的纯逻辑与状态机（不依赖 obsidian，因此可以直接测试）。
 *
 * 节点 key 直接使用题板条目的 key（如 `i0.abcd`），条目本身带列号，
 * 因此判断"是否相邻列"不需要额外编码。
 *
 * 交互规则：
 *   - 只允许**相邻两列**之间连线（第 1↔2、2↔3…），跨列连线一律拒绝。
 *   - 方向无关：从左往右点与从右往左点得到同一条线。
 *   - 每个条目在每一侧只保留一条连线；改连时**先建新线、再解旧线**。
 *   - 重复点击已连线的节点只是取消选中，不会静默删线。
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

	/** 条目 key → 与它相连的连线（每个条目在每一侧至多一条，故用 Set）。 */
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
	 * 只解除「某一端」上的连线，并清理该连线记录。
	 *
	 * 注意不能把两端都解掉：中间列的条目可以同时连左右两侧，
	 * 替换其中一条线时，另一侧的连线必须保留。
	 */
	function unlink(itemKey: string, connection: string): void {
		linksOf(itemKey).delete(connection);
		endpoints.delete(connection);
	}

	/**
	 * 建立连线，并解除被它取代的旧连线（先建后解）。
	 *
	 * 约束：**每个条目在同一对相邻列里至多一条连线**。
	 * 由于"一个答案可以被同列多个条目连上"（合并选项），
	 * 判断是否已有该列对的连线时，看的是连线在**小列那一侧**的端点：
	 *   - 同一左条目改连另一个答案 → 替换；
	 *   - 同一答案改由另一个左条目连上 → 替换；
	 *   - 两个不同左条目连到同一答案（一对多）→ 两条并存；
	 *   - 中间列条目的左右两侧属于不同列对 → 两条并存。
	 */
	function connect(firstKey: string, secondKey: string): boolean {
		const a = itemAt.get(firstKey);
		const b = itemAt.get(secondKey);
		if (a === undefined || b === undefined) return false;
		const connection = makeConnection(a, b);
		if (connection === null) return false;

		const columnOf = (key: string): number => itemAt.get(key)?.column ?? -1;
		const pairOf = (old: string): string | null => {
			const ends = endpoints.get(old);
			if (ends === undefined) return null;
			return [...ends.map(columnOf)].sort((x, y) => x - y).join("-");
		};
		/** 把一条连线归一化成 `[小列端, 大列端]`。 */
		const orderEnds = (old: string): [string, string] | null => {
			const ends = endpoints.get(old);
			if (ends === undefined) return null;
			return columnOf(ends[0]) <= columnOf(ends[1]) ? [ends[0], ends[1]] : [ends[1], ends[0]];
		};

		const ordered = [firstKey, secondKey].sort((x, y) => columnOf(x) - columnOf(y));
		const newSmall = ordered[0] ?? firstKey;
		const newLarge = ordered[1] ?? secondKey;
		const newPair = [columnOf(newSmall), columnOf(newLarge)].sort((x, y) => x - y).join("-");

		// 一对一匹配，但**不因"右端相同"而替换**：
		// 同一列的多个条目可以指向同一个答案（合并选项，如 MySQL / PostgreSQL → 关系型）。
		// 判定规则（只看同一对相邻列里的连线）：
		//   - 左端相同（同一左条目改连别的答案）→ 冲突，替换；
		//   - 右端相同**且**左端不同 → 不冲突，允许并存；
		//   - 其它情况（如中间列另一侧）→ 不同列对，不冲突。
		const conflicts = (old: string): boolean => {
			if (old === connection) return false;
			if (pairOf(old) !== newPair) return false;
			const ends = orderEnds(old);
			if (ends === null) return false;
			return ends[0] === newSmall;
		};

		const replaced = new Set<string>();
		for (const old of [...endpoints.keys()]) {
			if (conflicts(old)) replaced.add(old);
		}

		addConnection(connection, firstKey, secondKey);
		for (const old of replaced) {
			const oldEnds = endpoints.get(old);
			if (oldEnds === undefined) continue;
			for (const end of oldEnds) unlink(end, old);
		}
		return true;
	}

	return {
		click(itemKey: string): boolean {
			const item = itemAt.get(itemKey);
			if (item === undefined) return false;

			if (activeKey === null || activeKey === itemKey) {
				activeKey = activeKey === itemKey ? null : itemKey;
				return true;
			}

			const first = itemAt.get(activeKey);
			if (first === undefined) {
				activeKey = itemKey;
				return true;
			}

			// 点击「当前选中的那个已连线条目」= 取消选中，不删线。
			if (activeKey === itemKey) {
				activeKey = null;
				return true;
			}

			if (!connect(activeKey, itemKey)) {
				// 同列或跨列：改为选中新点中的条目（不产生连线）。
				activeKey = itemKey;
				return true;
			}
			activeKey = null;
			return true;
		},

		view(): BoardView {
			return { connections: [...endpoints.keys()], activeKey };
		},

		pairs(): BoardPair[] {
			return [...endpoints.values()].map((ends) => ({ left: ends[0], right: ends[1] }));
		},
	};
}
