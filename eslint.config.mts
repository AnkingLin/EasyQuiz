import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { globalIgnores, defineConfig } from 'eslint/config';

export default defineConfig(
	globalIgnores([
		'node_modules',
		'dist',
		'.test-build',
		'.scratch',
		'esbuild.config.mjs',
		'version-bump.mjs',
		'versions.json',
		'main.js',
		'package.json',
		'package-lock.json',
		'tsconfig.json',
		'tests/fixtures',
		// README 素材生成器的打包产物（源文件在 tools/readme-assets/ 下，仍然会被 lint）。
		'tools/readme-assets/browser/bundle.js',
		// 生成器的驱动脚本：node 下的 ESM，不属于插件的 TS 项目，也不参与 tsc 检查。
		'tools/readme-assets/generate.mjs',
		'tools/readme-assets/browser/build.mjs',
		'docs/assets',
	]),
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: ['eslint.config.mts', 'manifest.json'],
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json'],
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		// 测试是 node 程序，不是插件本体：它需要往终端输出结果，
		// 因此这里改用 node 环境，并且不套用面向发布产物的 obsidianmd 规则。
		files: ['tests/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/rule-custom-message': 'off',
			// 测试要自己搭建 DOM 辅助方法，这里并不存在 Obsidian 的 this.win。
			'obsidianmd/prefer-create-el': 'off',
			// 测试在 node 下运行，需要把 jsdom 的 window 装到 globalThis 上。
			'obsidianmd/no-global-this': 'off',
		},
	},
	{
		/*
		 * README 素材生成器：跑在浏览器 / node 下的构建工具，不是插件本体。
		 * 它为了模拟 Obsidian 环境必须自己搭 DOM 辅助方法、读写全局对象，
		 * 因此关掉那几条面向插件运行时的规则；代码风格规则照旧生效。
		 */
		files: ['tools/**/*.ts'],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
		rules: {
			'obsidianmd/rule-custom-message': 'off',
			// 生成器借用 Obsidian 的 createEl 风格 API 来搭壳，与插件本体无关。
			'obsidianmd/prefer-create-el': 'off',
			// 生成器需要把辅助方法装到 globalThis 上，浏览器里没有别的办法。
			'obsidianmd/no-global-this': 'off',
		},
	},
);

