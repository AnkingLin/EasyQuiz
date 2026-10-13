/**
 * 让测试可以直接 import Markdown fixture（由 esbuild 的 text loader 内联为字符串）。
 */
declare module "*.md" {
	const content: string;
	export default content;
}

/** 样式表同样由 esbuild 的 text loader 内联，供样式断言使用。 */
declare module "*.css" {
	const content: string;
	export default content;
}
