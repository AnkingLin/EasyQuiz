/**
 * 题面哈希：用于检测题目内容是否被改动（`rev` 字段）。
 *
 * FNV-1a：同步、确定、跨会话稳定。这里只需要"内容变了哈希就变"，
 * 不需要密码学强度，因此在插件与测试中使用同一份实现。
 */
export function contentHash(input: string): string {
	let hash = 2166136261;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}
