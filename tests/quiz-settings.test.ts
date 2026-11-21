/**
 * 设置校验与路径通配符测试。
 *
 * `data.json` 是用户/同步工具可以直接改的文件；坏类型必须被收敛回默认值，
 * 而不是让 `pathGlobs.some` 或解析器解构抛异常把插件卡死。
 */

import { DEFAULT_SETTINGS, parseSettingsSignature, sanitizeSettings } from "../src/settings";
import { compileGlob } from "../src/runtime";
import { assert, assertEqual, test } from "./harness";

test("设置校验：非对象输入回到默认值", () => {
	for (const raw of [null, undefined, 42, "quiz", [1, 2]]) {
		const settings = sanitizeSettings(raw);
		assertEqual(settings.pathGlobs.length, 0, `pathGlobs（输入：${JSON.stringify(raw)}）`);
		assertEqual(settings.headingLevels.join(","), "2,2", "headingLevels");
	}
});

test("设置校验：坏类型逐字段回退", () => {
	const settings = sanitizeSettings({
		language: "fr",
		blockLanguage: 7,
		headingLevels: 2,
		headingMode: "bogus",
		blankMarker: "underline",
		pathGlobs: "题库/**",
		historyLimit: -3,
		writeBackEnabled: "false",
		showStaleHint: "no",
	});
	assertEqual(settings.language, DEFAULT_SETTINGS.language, "语言");
	assertEqual(settings.blockLanguage, DEFAULT_SETTINGS.blockLanguage, "数据块语言");
	assertEqual(settings.headingLevels.join(","), "2,2", "标题层级");
	assertEqual(settings.headingMode, DEFAULT_SETTINGS.headingMode, "标题模式");
	assertEqual(settings.blankMarker, DEFAULT_SETTINGS.blankMarker, "空位标记");
	assertEqual(settings.pathGlobs.length, 0, "路径通配符");
	assertEqual(settings.historyLimit, DEFAULT_SETTINGS.historyLimit, "历史条数");
	assertEqual(settings.writeBackEnabled, true, "字符串 \"false\" 不应被当成关闭");
	assertEqual(settings.showStaleHint, true, "字符串 \"no\" 不应被当成关闭");
});

test("设置校验：合法值原样保留并做归一化", () => {
	const settings = sanitizeSettings({
		language: "zh",
		blockLanguage: "  q  ",
		headingLevels: [3, 3],
		headingMode: "auto",
		blankMarker: "both",
		pathGlobs: [" 题库/** ", "", 42, "笔记/*.md"],
		historyLimit: 3.9,
		writeBackEnabled: false,
		showStaleHint: false,
	});
	assertEqual(settings.language, "zh", "语言");
	assertEqual(settings.blockLanguage, "q", "数据块语言应去空白");
	assertEqual(settings.headingLevels.join(","), "3,3", "标题层级");
	assertEqual(settings.headingMode, "auto", "标题模式");
	assertEqual(settings.blankMarker, "both", "空位标记");
	assertEqual(settings.pathGlobs.join(","), "题库/**,笔记/*.md", "通配符应去空白并丢弃非字符串");
	assertEqual(settings.historyLimit, 3, "历史条数应取整");
	assertEqual(settings.writeBackEnabled, false, "写回开关");
	assertEqual(settings.showStaleHint, false, "提示开关");
});

test("设置指纹：解析相关字段变化才变，数据块语言不参与", () => {
	const base = sanitizeSettings({});
	const trimmed = parseSettingsSignature(base);
	assertEqual(parseSettingsSignature({ ...base, blockLanguage: "q" }), trimmed, "数据块语言要求重启，不进指纹");
	assert(parseSettingsSignature({ ...base, headingLevels: [3, 3] }) !== trimmed, "标题层级应进指纹");
	assert(parseSettingsSignature({ ...base, blankMarker: "both" }) !== trimmed, "空位标记应进指纹");
	assert(parseSettingsSignature({ ...base, pathGlobs: ["题库/**"] }) !== trimmed, "通配符应进指纹");
});

test("路径通配符：**/ 匹配零级或多级目录", () => {
	const matcher = compileGlob("**/*.md");
	assertEqual(matcher("a.md"), true, "根目录文件");
	assertEqual(matcher("x/a.md"), true, "一级目录");
	assertEqual(matcher("x/y/a.md"), true, "多级目录");
	assertEqual(matcher("a.txt"), false, "扩展名不匹配");
});

test("路径通配符：目录与单层通配", () => {
	const bank = compileGlob("题库/**");
	assertEqual(bank("题库/a.md"), true, "题库直下");
	assertEqual(bank("题库/子目录/a.md"), true, "题库子目录");
	assertEqual(bank("其它/a.md"), false, "不在题库目录");
	const oneLevel = compileGlob("quiz/*.md");
	assertEqual(oneLevel("quiz/a.md"), true, "一级");
	assertEqual(oneLevel("quiz/sub/a.md"), false, "不应跨目录");
});

test("路径通配符：? 只匹配一个字符，反斜杠路径被归一化", () => {
	const matcher = compileGlob("quiz/q?.md");
	assertEqual(matcher("quiz/q1.md"), true, "单字符");
	assertEqual(matcher("quiz/q12.md"), false, "不应匹配两个字符");
	assertEqual(compileGlob("题库/*.md")("题库\\a.md"), true, "Windows 反斜杠路径");
	const empty = compileGlob("   ");
	assertEqual(empty("a.md"), false, "空通配符不匹配任何文件");
});
