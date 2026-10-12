/**
 * 让测试可以直接 import Markdown fixture（由 esbuild 的 text loader 内联为字符串）。
 */
declare module "*.md" {
	const content: string;
	export default content;
}
