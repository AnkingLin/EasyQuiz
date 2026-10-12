/**
 * 连线题板逻辑与状态机测试。
 *
 * 重点覆盖实际报告过的问题：
 *   - 点不动（已连线判定用错集合 / 连线拆分下标写错）；
 *   - 第二列与第三列之间混乱（不能跨列、每列各自独立）；
 *   - 替换连线时先删后建，导致出现"什么都没连"的中间状态。
 */

import {
	answerOf,
	columnOf,
	connectionsOf,
	createBoardState,
	entryKeyOf,
	leftNodeKey,
	makeConnection,
	orderPair,
	rightNodeKey,
	splitConnection,
	slotKey,
} from "../src/match-board";
import { assert, assertEqual, test } from "./harness";

// ---------------------------------------------------------------------------
// key 与拆分
// ---------------------------------------------------------------------------

test("左节点 key 带 L 前缀，右节点 key 带 R 前缀与列号", () => {
	assertEqual(leftNodeKey("c0.abcd"), "L|c0.abcd", "左节点 key");
	assertEqual(rightNodeKey(0, "80"), "R|0|80", "右节点 key");
});

test("配对方向与点击顺序无关", () => {
	const left = leftNodeKey("c0.a");
	const right = rightNodeKey(0, "80");
	assertEqual(makeConnection(left, right), "L|c0.a|R|0|80", "先左后右");
	assertEqual(makeConnection(right, left), "L|c0.a|R|0|80", "先右后左应得到同一条线");
});

test("同侧的两个节点不能连成线", () => {
	assertEqual(orderPair(leftNodeKey("c0.a"), leftNodeKey("c0.b"))[0], null, "左左不应成对");
	assertEqual(orderPair(rightNodeKey(0, "80"), rightNodeKey(0, "22"))[0], null, "右右不应成对");
	assertEqual(makeConnection(leftNodeKey("c0.a"), leftNodeKey("c0.b")), null, "左左不产生连线");
});

test("可以强制要求右节点属于指定列（禁止跨列）", () => {
	const left = leftNodeKey("c0.a");
	const sameColumn = rightNodeKey(0, "80");
	const otherColumn = rightNodeKey(1, "80");
	assertEqual(makeConnection(left, sameColumn, 0), "L|c0.a|R|0|80", "同列应可连线");
	assertEqual(makeConnection(left, otherColumn, 0), null, "跨列应被拒绝");
});

test("连线可以被拆回左右节点，并能还原列号", () => {
	const connection = makeConnection(leftNodeKey("c0.abc"), rightNodeKey(1, "关系型"))!;
	const [left, right] = splitConnection(connection);
	assertEqual(left, "L|c0.abc", "左节点");
	assertEqual(right, "R|1|关系型", "右节点");
	assertEqual(entryKeyOf(left!), "c0.abc", "还原条目 key");
	assertEqual(answerOf(right!), "关系型", "还原答案");
	assertEqual(columnOf(right!), 1, "还原列号");
});

test("答案本身含竖线时仍能正确还原列号与答案", () => {
	const connection = makeConnection(leftNodeKey("c0.a"), rightNodeKey(2, "a|b"))!;
	const [, right] = splitConnection(connection);
	assertEqual(columnOf(right!), 2, "列号应正确");
	assertEqual(answerOf(right!), "a|b", "答案里的竖线应保留");
});

test("格式不符的连线不会解析出节点", () => {
	assertEqual(splitConnection("垃圾数据")[0], null, "垃圾数据应返回 null");
	assertEqual(splitConnection("L|c0.a")[0], null, "缺少右侧时应返回 null");
});

test("能找出涉及某节点的所有连线", () => {
	const leftA = leftNodeKey("c0.a");
	const right80 = rightNodeKey(0, "80");
	const connections = [makeConnection(leftA, right80)!];
	assertEqual(connectionsOf(connections, leftA).length, 1, "左节点 A 有一条");
	assertEqual(connectionsOf(connections, right80).length, 1, "右节点 80 有一条");
	assertEqual(connectionsOf(connections, leftNodeKey("c0.zzz")).length, 0, "未连线的节点没有连线");
});

test("回归：已连线节点的判定必须用连线集合而不是节点 key", () => {
	// 曾经的缺陷：用 connections.has(nodeKey) 判断，永远为 false。
	const left = leftNodeKey("c0.a");
	const right = rightNodeKey(0, "80");
	const connections = new Set<string>([makeConnection(left, right)!]);
	assertEqual(connections.has(left), false, "节点 key 本身不在连线集合里");
	assertEqual(connectionsOf(connections, left).length, 1, "必须通过 connectionsOf 判断");
});

test("回归：连线里 R 标记在下标 2，不是 3", () => {
	const connection = "L|c0.abc|R|1|关系型";
	const [left, right] = splitConnection(connection);
	assertEqual(left, "L|c0.abc", "左节点应能解析");
	assertEqual(right, "R|1|关系型", "右节点应能解析");
});

// ---------------------------------------------------------------------------
// 状态机：基本交互
// ---------------------------------------------------------------------------

const leftA = leftNodeKey("c0.a");
const leftB = leftNodeKey("c0.b");
const right0_80 = rightNodeKey(0, "80");
const right0_22 = rightNodeKey(0, "22");
const right1_应用 = rightNodeKey(1, "应用层");
const right1_网络 = rightNodeKey(1, "网络层");

function board() {
	return createBoardState([
		{ key: leftA, column: null },
		{ key: leftB, column: null },
		{ key: right0_80, column: 0 },
		{ key: right0_22, column: 0 },
		{ key: right1_应用, column: 1 },
		{ key: right1_网络, column: 1 },
	]);
}

test("选中左节点、再点右节点即可建立连线", () => {
	const state = board();
	state.click(leftA);
	assertEqual(state.view().activeKey, leftA, "左节点应处于选中状态");
	state.click(right0_80);
	assertEqual(state.view().activeKey, null, "连线后应清除选中");
	assertEqual(state.view().connections.join(","), "L|c0.a|R|0|80", "应生成一条连线");
	assertEqual(state.pairs().length, 1, "应产出一组答案");
	assertEqual(state.pairs()[0]?.target, "80", "答案");
});

test("同一节点再次点击只是取消选中，不会删除已有连线", () => {
	const state = board();
	state.click(leftA);
	state.click(right0_80);
	// 点击已连线的左节点：只是选中，连线保持。
	state.click(leftA);
	assertEqual(state.view().activeKey, leftA, "应变为选中");
	assertEqual(state.view().connections.length, 1, "连线不应被删除");
	state.click(leftA);
	assertEqual(state.view().activeKey, null, "再次点击取消选中");
	assertEqual(state.view().connections.length, 1, "连线仍然存在");
});

test("未选中左节点时点击右节点不会建立连线", () => {
	const state = board();
	state.click(right0_80);
	assertEqual(state.view().connections.length, 0, "不应产生连线");
	assertEqual(state.view().activeKey, right0_80, "应选中该右节点");
});

// ---------------------------------------------------------------------------
// 状态机：禁止跨列
// ---------------------------------------------------------------------------

test("右节点只能连到它所属的列（不允许跨列）", () => {
	const state = board();
	state.click(leftA);
	state.click(right0_80);
	assertEqual(state.view().activeColumn, 0, "当前列应为 0");

	// 同一左条目连到另一列：应当允许（每列各自一条线）。
	state.click(leftA);
	state.click(right1_应用);
	const view = state.view();
	assertEqual(view.connections.length, 2, "两列各有一条连线");
	assertEqual(state.pairs().length, 2, "两列各产出一组答案");
	assert(view.connections.includes("L|c0.a|R|0|80"), "第一列连线应保留");
	assert(view.connections.includes("L|c0.a|R|1|应用层"), "第二列连线应保留");
});

test("第一列的连线不会被第二列的操作影响", () => {
	const state = board();
	state.click(leftA);
	state.click(right0_80);
	state.click(leftB);
	state.click(right0_22);
	assertEqual(state.view().connections.length, 2, "第一列应有两条连线");

	// 切到第二列操作，第一列结果必须原样保留。
	state.click(leftA);
	state.click(right1_应用);
	state.click(leftB);
	state.click(right1_网络);
	const connections = state.view().connections;
	assertEqual(connections.length, 4, "两列共四条连线");
	assert(connections.includes("L|c0.a|R|0|80"), "第一列 A 的连线应保留");
	assert(connections.includes("L|c0.b|R|0|22"), "第一列 B 的连线应保留");
	assert(connections.includes("L|c0.a|R|1|应用层"), "第二列 A 的连线应存在");
	assert(connections.includes("L|c0.b|R|1|网络层"), "第二列 B 的连线应存在");
});

test("activeColumn 跟随最近使用的列", () => {
	const state = board();
	state.click(leftA);
	state.click(right0_80);
	assertEqual(state.view().activeColumn, 0, "第一列");
	state.click(leftB);
	state.click(right1_应用);
	assertEqual(state.view().activeColumn, 1, "第二列");
});

// ---------------------------------------------------------------------------
// 状态机：替换连线（先建后解）
// ---------------------------------------------------------------------------

test("同列改答案：新连线建立后旧连线才解除", () => {
	const state = board();
	state.click(leftA);
	state.click(right0_80);
	state.click(leftA);
	state.click(right0_22);
	const connections = state.view().connections;
	assertEqual(connections.length, 1, "同一列里一个条目只保留一条连线");
	assertEqual(connections[0], "L|c0.a|R|0|22", "应换成新答案");
});

test("同列改条目：答案上原有连线被新连线取代", () => {
	const state = board();
	state.click(leftA);
	state.click(right0_80);
	state.click(leftB);
	state.click(right0_80);
	const connections = state.view().connections;
	assertEqual(connections.length, 1, "一个答案在同一列里只被连一次");
	assertEqual(connections[0], "L|c0.b|R|0|80", "应换成新条目");
});

test("替换时先建立新连线，再解除旧的（不会出现空档）", () => {
	const state = board();
	state.click(leftA);
	state.click(right0_80);
	// 直接把 A 改连到 22：点击 22 之后必须立即有连线，而不是先断后连。
	state.click(leftA);
	state.click(right0_22);
	assertEqual(state.view().connections.length, 1, "任意时刻都应恰好有一条连线");
	assertEqual(state.view().connections[0], "L|c0.a|R|0|22", "指向新答案");
});

test("每列的连线互不覆盖", () => {
	const state = board();
	state.click(leftA);
	state.click(right0_80);
	state.click(leftA);
	state.click(right1_应用);
	// 再改第二列，第一列不应受影响。
	state.click(leftA);
	state.click(right1_网络);
	const connections = state.view().connections;
	assertEqual(connections.length, 2, "两列各一条");
	assert(connections.includes("L|c0.a|R|0|80"), "第一列的连线必须保留");
	assert(connections.includes("L|c0.a|R|1|网络层"), "第二列已换成新答案");
});

test("slotKey 让同一条目在不同列拥有独立槽位", () => {
	assert(slotKey("c0.a", 0) !== slotKey("c0.a", 1), "不同列的槽位应不同");
	assertEqual(slotKey("c0.a", 0), "c0.a@0", "槽位格式");
});

test("未知节点被忽略，不改变状态", () => {
	const state = board();
	assertEqual(state.click("L|不存在"), false, "未知节点应返回未变化");
	assertEqual(state.view().connections.length, 0, "不应产生连线");
});
