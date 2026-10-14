/*
 * README 素材生成器的打包配置。
 *
 * 与 `esbuild.config.mjs` 的 test 模式同一套思路：把 `obsidian` alias 到浏览器存根，
 * 这样 `src/` 下的真实渲染代码可以直接在浏览器里跑起来。
 */

import esbuild from "esbuild";

await esbuild.build({
	entryPoints: ["tools/readme-assets/browser/entry.ts"],
	bundle: true,
	platform: "browser",
	format: "iife",
	target: "es2020",
	alias: { obsidian: "./tools/readme-assets/browser/obsidian.ts" },
	outfile: "tools/readme-assets/browser/bundle.js",
	logLevel: "info",
});
