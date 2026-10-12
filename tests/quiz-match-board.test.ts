/**
 * 连线题板逻辑测试。
 *
 * 这一层专门覆盖"点击连线点不动"这类问题：key 的构造、配对方向、拆分与查找。
 */

import {
	answerOf,
	connectionsOf,
	entryKeyOf,
	leftNodeKey,
	makeConnection,
	orderPair,
	rightNodeKey,
	splitConnection,
} from "../src/match-board";
import { assert, assertEqual, test } from "./harness";

test("左节点 key 带 L 前缀，右节点 key 带 R 前缀与列号", () => {
	assertEqual(leftNodeKey("c0.abcd"), "L|c0.abcd", "左节点 key");
	assertEqual(rightNodeKey(0, "80"), "R|0|80", "右节点 key");
});

test("配对方向与点击顺序无关", () => {
	const left = leftNodeKey("c0.a");
	const right = rightNodeKey(0, "80");
	assertEqual(makeConnection(left, right), `L|c0.a|R|0|80`, "先左后右");
	assertEqual(makeConnection(right, left), `L|c0.a|R|0|80`, "先右后左应得到同一条线");
});

test("同侧的两个节点不能连成线", () => {
	assertEqual(orderPair(leftNodeKey("c0.a"), leftNodeKey("c0.b"))[0], null, "左左不应成对");
	assertEqual(orderPair(rightNodeKey(0, "80"), rightNodeKey(0, "22"))[0], null, "右右不应成对");
	assertEqual(makeConnection(leftNodeKey("c0.a"), leftNodeKey("c0.b")), null, "左左不产生连线");
});

test("连线可以被拆回左右节点", () => {
	const connection = makeConnection(leftNodeKey("c0.abc"), rightNodeKey(1, "关系型"))!;
	const [left, right] = splitConnection(connection);
	assertEqual(left, "L|c0.abc", "左节点");
	assertEqual(right, "R|1|关系型", "右节点");
	assertEqual(entryKeyOf(left!), "c0.abc", "还原条目 key");
	assertEqual(answerOf(right!), "关系型", "还原答案");
});

test("答案本身含竖线时仍能正确还原", () => {
	const connection = makeConnection(leftNodeKey("c0.a"), rightNodeKey(0, "a|b"))!;
	const [, right] = splitConnection(connection);
	assertEqual(answerOf(right!), "a|b", "答案里的竖线应保留");
});

test("格式不符的连线不会解析出节点", () => {
	assertEqual(splitConnection("垃圾数据")[0], null, "垃圾数据应返回 null");
	assertEqual(splitConnection("L|c0.a")[0], null, "缺少右侧时应返回 null");
});

test("能找出涉及某节点的所有连线", () => {
	const leftA = leftNodeKey("c0.a");
	const leftB = leftNodeKey("c0.b");
	const right80 = rightNodeKey(0, "80");
	const right22 = rightNodeKey(0, "22");
	const connections = [makeConnection(leftA, right80)!, makeConnection(leftB, right22)!];

	assertEqual(connectionsOf(connections, leftA).length, 1, "左节点 A 有一条");
	assertEqual(connectionsOf(connections, right22).length, 1, "右节点 22 有一条");
	assertEqual(connectionsOf(connections, leftNodeKey("c0.zzz")).length, 0, "未连线的节点没有连线");
	assertEqual(connectionsOf(connections, leftA)[0], makeConnection(leftA, right80), "返回的是整条连线");
});

test("回归：已连线节点的判定必须用连线集合而不是节点 key", () => {
	// 曾经的缺陷：用 connections.has(nodeKey) 判断，永远为 false，
	// 于是点击已连线的节点不会断开，而点击第二个节点也不会生成连线。
	const left = leftNodeKey("c0.a");
	const right = rightNodeKey(0, "80");
	const connections = new Set<string>([makeConnection(left, right)!]);

	assertEqual(connections.has(left), false, "节点 key 本身不在连线集合里");
	assertEqual(connectionsOf(connections, left).length, 1, "必须通过 connectionsOf 判断");
	assertEqual(connectionsOf(connections, right).length, 1, "右侧同理");
});

test("多列时不同列的相同答案互不影响", () => {
	const left = leftNodeKey("c0.a");
	const first = rightNodeKey(0, "相同答案");
	const second = rightNodeKey(1, "相同答案");
	const connection = makeConnection(left, first)!;
	assert(connection !== makeConnection(left, second), "不同列的相同答案应是不同的连线");
	assertEqual(connectionsOf([connection], second).length, 0, "不应误判为同一列");
});
