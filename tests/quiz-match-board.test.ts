/**
 * 连线题板逻辑与状态机测试。
 *
 * 规则（都由这里固定下来）：
 *   1. 每一列只允许与**相邻列**连线；
 *   2. 禁止跨列连线；
 *   3. 从左到右与从右到左是**同一条线**（判分等效）。
 */

import {
	connectionsOf,
	createBoardState,
	makeConnection,
	splitConnection,
} from "../src/match-board";
import { BoardItem } from "../src/types";
import { assert, assertEqual, test } from "./harness";

// 三列：A(0) - B(1) - C(2)
const A1: BoardItem = { key: "i0.a1", text: "A1", column: 0 };
const A2: BoardItem = { key: "i0.a2", text: "A2", column: 0 };
const B1: BoardItem = { key: "i1.b1", text: "B1", column: 1 };
const B2: BoardItem = { key: "i1.b2", text: "B2", column: 1 };
const C1: BoardItem = { key: "i2.c1", text: "C1", column: 2 };
const C2: BoardItem = { key: "i2.c2", text: "C2", column: 2 };
const ALL = [A1, A2, B1, B2, C1, C2];

// ---------------------------------------------------------------------------
// 相邻列判定
// ---------------------------------------------------------------------------

test("相邻列可以连线", () => {
	assertEqual(makeConnection(A1, B1), "i0.a1~i1.b1", "A-B 相邻，可以连线");
	assertEqual(makeConnection(B1, C1), "i1.b1~i2.c1", "B-C 相邻，可以连线");
});

test("同列不能连线", () => {
	assertEqual(makeConnection(A1, A2), null, "同列不应成线");
	assertEqual(makeConnection(B1, B2), null, "同列不应成线");
});

test("跨列（相隔一列以上）不能连线", () => {
	assertEqual(makeConnection(A1, C1), null, "A 与 C 相隔一列，禁止连线");
	assertEqual(makeConnection(C1, A1), null, "反向同样禁止");
});

test("方向无关：从左到右与从右到左是同一条线", () => {
	assertEqual(makeConnection(A1, B1), makeConnection(B1, A1), "两个方向应得到同一条线");
	assertEqual(makeConnection(A2, B2), makeConnection(B2, A2), "两个方向应得到同一条线");
});

test("连线始终规范化为「列号小~列号大」", () => {
	const forward = makeConnection(A1, B1);
	const backward = makeConnection(B1, A1);
	assertEqual(splitConnection(forward!)[0], "i0.a1", "左端应是列号小的条目");
	assertEqual(splitConnection(backward!)[1], "i1.b1", "右端应是列号大的条目");
});

test("拆分连线", () => {
	assertEqual(splitConnection("i0.a1~i1.b1").join("|"), "i0.a1|i1.b1", "正常拆分");
	assertEqual(splitConnection("垃圾数据")[0], null, "非法输入返回 null");
});

test("能找出涉及某条目的所有连线", () => {
	const connection = makeConnection(A1, B1)!;
	assertEqual(connectionsOf([connection], "i0.a1").length, 1, "左端应能查到");
	assertEqual(connectionsOf([connection], "i1.b1").length, 1, "右端应能查到");
	assertEqual(connectionsOf([connection], "i0.a2").length, 0, "无关条目查不到");
});

// ---------------------------------------------------------------------------
// 状态机
// ---------------------------------------------------------------------------

function board() {
	return createBoardState(ALL);
}

test("选中左列条目，再点相邻列条目即可连线", () => {
	const state = board();
	state.click(A1.key);
	assertEqual(state.view().activeKey, A1.key, "应处于选中状态");
	state.click(B1.key);
	assertEqual(state.view().activeKey, null, "连线后清除选中");
	assertEqual(state.view().connections.join(","), "i0.a1~i1.b1", "应生成一条相邻列连线");
});

test("从右往左点也能连成同一条线", () => {
	const state = board();
	state.click(B1.key);
	state.click(A1.key);
	assertEqual(state.view().connections.join(","), "i0.a1~i1.b1", "结果应与从左往右一致");
});

test("跨列连线被拒绝（A 与 C）", () => {
	const state = board();
	state.click(A1.key);
	state.click(C1.key);
	assertEqual(state.view().connections.length, 0, "不应产生连线");
	assertEqual(state.view().activeKey, C1.key, "应改为选中被点中的条目");
});

test("同一列的另一个条目被点中时不会连线", () => {
	const state = board();
	state.click(A1.key);
	state.click(A2.key);
	assertEqual(state.view().connections.length, 0, "同列不应连线");
	assertEqual(state.view().activeKey, A2.key, "应改为选中该条目");
});

test("中间列条目可以同时连左右相邻列", () => {
	const state = board();
	state.click(A1.key);
	state.click(B1.key);
	// B1 与 A 列已连；现在用中间列作为起点连 B-C，两条应同时存在。
	state.click(B1.key);
	state.click(C1.key);
	const connections = state.view().connections;
	assertEqual(connections.length, 2, `中间列条目应能连左右各一条（实际 ${JSON.stringify(connections)}）`);
	assert(connections.includes("i0.a1~i1.b1"), "应有 A-B 连线");
	assert(connections.includes("i1.b1~i2.c1"), "应有 B-C 连线");
});

test("每一对相邻列各自只保留一条：改连时先建后解", () => {
	const state = board();
	state.click(A1.key);
	state.click(B1.key);
	// 同一对列（A-B）里把 A1 改连 B2。
	state.click(A1.key);
	state.click(B2.key);
	const connections = state.view().connections;
	assertEqual(connections.length, 1, "A1 与 B 列之间只应保留一条");
	assertEqual(connections[0], "i0.a1~i1.b2", "应换成 B2");
});

test("同一对列里右端可被多个左条目连上（合并选项）", () => {
	const state = board();
	state.click(A1.key);
	state.click(B1.key);
	state.click(A2.key);
	state.click(B1.key);
	const connections = state.view().connections;
	assertEqual(connections.length, 2, "同一答案允许同列多个条目连上");
	assert(connections.includes("i0.a1~i1.b1"), "A1-B1 应保留");
	assert(connections.includes("i0.a2~i1.b1"), "A2-B1 应新增");
});

test("同一对列里一个左条目只能连一条（改连即替换）", () => {
	const state = board();
	state.click(A1.key);
	state.click(B1.key);
	state.click(A1.key);
	state.click(B2.key);
	const connections = state.view().connections;
	assertEqual(connections.length, 1, "A1 只应保留一条连线");
	assertEqual(connections[0], "i0.a1~i1.b2", "应换成 B2");
});

test("再次点击已连线的条目只是取消选中，不删线", () => {
	const state = board();
	state.click(A1.key);
	state.click(B1.key);
	state.click(A1.key);
	assertEqual(state.view().activeKey, A1.key, "应变为选中");
	assertEqual(state.view().connections.length, 1, "连线不应被删除");
	state.click(A1.key);
	assertEqual(state.view().activeKey, null, "再次点击取消选中");
	assertEqual(state.view().connections.length, 1, "连线仍在");
});

test("三列串起来：A-B 两条、B-C 两条", () => {
	const state = board();
	for (const [first, second] of [
		[A1, B1],
		[A2, B2],
		[B1, C1],
		[B2, C2],
	] as const) {
		state.click(first.key);
		state.click(second.key);
	}
	const connections = state.view().connections;
	assertEqual(connections.length, 4, `应有四条连线（实际 ${JSON.stringify(connections)}）`);
	assert(connections.includes("i0.a1~i1.b1"), "A1-B1");
	assert(connections.includes("i0.a2~i1.b2"), "A2-B2");
	assert(connections.includes("i1.b1~i2.c1"), "B1-C1");
	assert(connections.includes("i1.b2~i2.c2"), "B2-C2");
});

test("pairs() 给出规范化的左右端点", () => {
	const state = board();
	state.click(A1.key);
	state.click(B1.key);
	const pairs = state.pairs();
	assertEqual(pairs.length, 1, "一条连线");
	assertEqual(pairs[0]?.left, "i0.a1", "左端应是列号小的条目");
	assertEqual(pairs[0]?.right, "i1.b1", "右端应是列号大的条目");
});

test("从右往左建立时 pairs() 同样规范化", () => {
	const state = board();
	state.click(B1.key);
	state.click(A1.key);
	const pairs = state.pairs();
	assertEqual(pairs[0]?.left, "i0.a1", "左端仍是列号小的条目");
	assertEqual(pairs[0]?.right, "i1.b1", "右端仍是列号大的条目");
});

test("未知条目被忽略", () => {
	const state = board();
	assertEqual(state.click("不存在"), false, "应返回未变化");
	assertEqual(state.view().connections.length, 0, "不应产生连线");
});
