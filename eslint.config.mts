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
);

