/**
 * README 素材生成器。
 *
 * 为什么不直接用 headless 浏览器截一次就完事：`--screenshot` 的输出尺寸由启动时
 * 的 `--window-size` 决定，而每个场景的高度要等它渲染完才知道。所以每个场景走两遍：
 *   1. `--dump-dom` 读回页面写在 `<html data-scene-height>` 上的真实高度；
 *   2. 用该高度 + 固定宽度再截一次图。
 *
 * 用 node 而不是 PowerShell 驱动：脚本里有大量中文注释，Windows PowerShell 5.1
 * 读没有 BOM 的 UTF-8 脚本会乱码，node 没有这个问题。
 *
 * 用法：
 *   node tools/readme-assets/generate.mjs                  # 全部场景
 *   node tools/readme-assets/generate.mjs --scene card-single --dir en
 *   node tools/readme-assets/generate.mjs --skip-gif       # 只出静态图
 */

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const outRoot = join(root, "docs/assets");
const tmpRoot = join(root, ".test-build/readme-assets");
const scale = Number(process.env["EQQ_ASSET_SCALE"] ?? 2);

// ------------------------------------------------------------------ 参数

const argv = process.argv.slice(2);
function flag(name) {
	return argv.includes(`--${name}`);
}
function option(name) {
	const index = argv.indexOf(`--${name}`);
	return index >= 0 ? argv[index + 1] : undefined;
}
const onlyScene = option("scene");
const onlyDir = option("dir");
const skipGif = flag("skip-gif");

// ---------------------------------------------------------------- 浏览器

/** 找一个可用的 Chromium 内核浏览器（Edge 在 Windows 上基本总是有）。 */
function findBrowser() {
	const candidates = [
		process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "Microsoft/Edge/Application/msedge.exe"),
		process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Microsoft/Edge/Application/msedge.exe"),
		process.env["ProgramFiles"] && join(process.env["ProgramFiles"], "Google/Chrome/Application/chrome.exe"),
		process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Google/Chrome/Application/chrome.exe"),
		process.env["LOCALAPPDATA"] && join(process.env["LOCALAPPDATA"], "Google/Chrome/Application/chrome.exe"),
		"/usr/bin/google-chrome",
		"/usr/bin/chromium",
		"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
	].filter((path) => typeof path === "string");
	for (const path of candidates) {
		if (existsSync(path)) return path;
	}
	throw new Error("找不到 Edge 或 Chrome，无法生成截图。");
}

const browser = findBrowser();
console.log(`浏览器：${browser}`);

// ------------------------------------------------------------------ 打包

console.log("打包渲染器…");
execFileSync(process.execPath, [join(here, "browser/build.mjs")], { stdio: "inherit" });

const indexUrl = `file:///${join(here, "browser/index.html").replace(/\\/g, "/")}`;
mkdirSync(tmpRoot, { recursive: true });
mkdirSync(join(tmpRoot, "profile"), { recursive: true });

// ------------------------------------------------ headless 调用的小工具

/**
 * 跑一次 headless 浏览器。
 *
 * `--dump-dom` 与 `--screenshot` 互斥，因此调用方按需选一个。
 */
function headless(args) {
	const result = spawnSync(
		browser,
		[
			"--headless=new",
			"--disable-gpu",
			"--no-sandbox",
			"--hide-scrollbars",
			"--disable-extensions",
			"--no-first-run",
			`--force-device-scale-factor=${scale}`,
			`--user-data-dir=${join(tmpRoot, "profile")}`,
			"--virtual-time-budget=20000",
			...args,
		],
		{ encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 }
	);
	if (result.error) throw result.error;
	return result.stdout ?? "";
}

/** 读回某个 URL 渲染后的 DOM。 */
function dumpDom(url) {
	return headless(["--dump-dom", url]);
}

/** 从 DOM 里取出页面报告的失败原因。 */
function sceneError(dom) {
	const match = /<pre id="list"[^>]*>([\s\S]*?)<\/pre>/.exec(dom);
	return match ? match[1] : dom.slice(0, 800);
}

/**
 * 量一个场景的真实高度与内容宽度。
 *
 * 必须传 `--window-size`：`scrollWidth` 至少等于视口宽度，不给视口就拿到
 * 浏览器的默认宽度，量出来的"内容宽度"没有意义。给了场景宽度之后，
 * `scrollWidth > width` 才真的表示内容溢出。
 */
function measure(url, width) {
	const dom = headless([`--window-size=${width},900`, "--dump-dom", url]);
	if (dom.includes('data-ready="error"')) throw new Error(`场景生成失败：\n${sceneError(dom)}`);
	if (!dom.includes('data-ready="1"')) throw new Error(`页面没有报告就绪：${url}`);
	const height = /data-scene-height="(\d+)"/.exec(dom);
	if (!height) throw new Error(`页面没有报告高度：${url}`);
	const measured = /data-scene-width="(\d+)"/.exec(dom);
	return {
		height: Number.parseInt(height[1], 10),
		width: measured ? Number.parseInt(measured[1], 10) : 0,
		dom,
	};
}

/**
 * 校验场景里的表单状态。
 *
 * 对话框的题干输入框如果是空的，截图就没有说明力（读者看不到插件真的填好了默认标题）；
 * 题库列表的勾选框则本来就该是空的（勾选状态用行高亮表示）。两类分别处理。
 */
function checkFormState(dom, label) {
	// 对话框：输入框必须有值。
	if (label.includes("modal-insert")) {
		const inputs = [...dom.matchAll(/<input[^>]*>/g)].map((match) => match[0]);
		const textInputs = inputs.filter((tag) => tag.includes('type="text"'));
		for (const tag of textInputs) {
			const value = /data-value="([^"]*)"/.exec(tag);
			if (!value || value[1] === "") {
				throw new Error(
					`对话框的题干输入框是空的，截图会误导读者：${label}\n` +
						`  （Modal.open() 之后组件应带默认标题，检查 InsertQuestionModal 的初始化）`
				);
			}
		}
	}
}

/** 按真实尺寸截一张图。 */
function screenshot(url, target, width, height) {
	headless([`--window-size=${width},${height}`, `--screenshot=${target}`, url]);
	if (!existsSync(target)) throw new Error(`截图没有生成：${target}`);
}

// ---------------------------------------------------------------- 场景清单

console.log("枚举场景…");
const listDom = dumpDom(`${indexUrl}?list=1`);
if (listDom.includes('data-ready="error"')) throw new Error(`场景清单生成失败：\n${sceneError(listDom)}`);
const listMatch = /<pre id="list"[^>]*>([\s\S]*?)<\/pre>/.exec(listDom);
if (!listMatch || listMatch[1].trim() === "") throw new Error("拿不到场景清单");
let scenes = JSON.parse(listMatch[1]);

if (onlyScene) {
	scenes = scenes.filter(
		(scene) => scene.name === onlyScene && (onlyDir === undefined || scene.dir === onlyDir)
	);
	if (scenes.length === 0) throw new Error(`没有匹配的场景：${onlyScene} / ${onlyDir}`);
}

console.log(`共 ${scenes.length} 个场景。`);

// ------------------------------------------------------------ 逐场景截图

/** group → dir → 帧列表。 */
const frames = new Map();
let done = 0;

for (const scene of scenes) {
	done++;
	const isFrame = scene.group !== null;
	const targetDir = isFrame ? join(tmpRoot, `frames/${scene.group}-${scene.dir}`) : join(outRoot, scene.dir);
	mkdirSync(targetDir, { recursive: true });

	const fileName = isFrame ? `${String(scene.index).padStart(3, "0")}.png` : `${scene.name}.png`;
	const target = join(targetDir, fileName);

	const base = `${indexUrl}?scene=${scene.name}&dir=${scene.dir}`;
	// 动画帧必须把帧号传给页面：同一个 name+dir 有多帧，不带帧号就只会渲染第一帧，
	// GIF 会退化成一个静止画面。
	const frameQuery = scene.group === null ? "" : `&index=${scene.index}`;
	const frameUrl = `${base}${frameQuery}`;
	const measured = measure(frameUrl, scene.width);
	// 上下留一点余量，防止抗锯齿边缘被切掉。
	const height = Math.ceil(measured.height) + 4;

	// 内容比场景宽度还宽 = 会被切掉。这是素材生成里最容易悄悄出错的地方
	// （长解析、长路径都会触发），所以直接报错而不是产出一张残缺的图。
	if (measured.width > scene.width + 1) {
		throw new Error(
			`内容比视口宽，截图会被切掉：${scene.dir}/${scene.name}\n` +
				`  视口 ${scene.width}px，内容 ${measured.width}px。` +
				`请调大该场景的 width，或缩短夹具里的长文本。`
		);
	}

	// 空输入框 / 未勾选的复选框会让截图误导读者，这里一并拦下来：
	// 场景要么真的填了值，要么就是刻意展示空态（list 页的勾选框）。
	checkFormState(measured.dom, `${scene.dir}/${scene.name}`);

	screenshot(`${frameUrl}&height=${height}`, target, scene.width, height);

	if (isFrame) {
		if (!frames.has(scene.group)) frames.set(scene.group, new Map());
		const byDir = frames.get(scene.group);
		if (!byDir.has(scene.dir)) byDir.set(scene.dir, []);
		byDir.get(scene.dir).push({ path: target, index: scene.index, delay: scene.delayMs ?? 700 });
	}

	console.log(`  [${done}/${scenes.length}] ${scene.dir}/${scene.name}  ${scene.width}x${height}`);
}

// --------------------------------------------------------------- 动画校验

/*
 * 动画帧必须真的不一样。
 *
 * 这里踩过一次坑：帧号没有传给页面时，每一"帧"都会渲染成第一帧，
 * 合成出来的 GIF 是一个静止画面——文件名和帧数都没问题，只有内容不对。
 * 直接比对帧文件的内容哈希，能在合成之前就把这种情况拦下来。
 */
if (!skipGif) {
	for (const [group, byDir] of frames) {
		for (const [dir, list] of byDir) {
			if (list.length < 2) {
				throw new Error(`动画 ${group}/${dir} 只有 ${list.length} 帧，至少需要 2 帧`);
			}
			const hashes = new Set(list.map((frame) => createHash("sha256").update(readFileSync(frame.path)).digest("hex")));
			if (hashes.size === 1) {
				throw new Error(
					`动画 ${group}/${dir} 的 ${list.length} 帧内容完全相同，GIF 会是静止的。\n` +
						`  最常见的原因：帧号没有传给页面（见 buildScene 的 index 参数）。`
				);
			}
		}
	}
}

// --------------------------------------------------------------- GIF 合成

if (skipGif) {
	console.log("跳过了 GIF 合成。");
} else if (frames.size === 0) {
	console.log("没有动画场景，跳过 GIF 合成。");
} else if (spawnSync("ffmpeg", ["-version"], { stdio: "ignore" }).status !== 0) {
	console.warn("没有找到 ffmpeg，跳过 GIF 合成（静态图已生成）。");
} else {
	for (const [group, byDir] of frames) {
		for (const [dir, listRaw] of byDir) {
			const list = [...listRaw].sort((a, b) => a.index - b.index);
			const targetDir = join(outRoot, dir);
			mkdirSync(targetDir, { recursive: true });
			const outFile = join(targetDir, `${group}.gif`);

			// concat demuxer：每帧自己的时长写在列表里。末帧重复一次，
			// 否则最后一帧的 duration 不生效（GIF 会提前循环）。
			const lines = [];
			for (const frame of list) {
				lines.push(`file '${frame.path.replace(/\\/g, "/")}'`);
				lines.push(`duration ${(frame.delay / 1000).toFixed(3)}`);
			}
			lines.push(`file '${list[list.length - 1].path.replace(/\\/g, "/")}'`);
			const listFile = join(tmpRoot, `${group}-${dir}.txt`);
			writeFileSync(listFile, lines.join("\n"), "utf8");

			// 调色板两遍法：GIF 只有 256 色，不量化会有明显色带。
			const palette = join(tmpRoot, `${group}-${dir}-palette.png`);
			const common = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listFile];
			const gen = spawnSync("ffmpeg", [...common, "-vf", "palettegen=stats_mode=diff", palette], {
				stdio: "inherit",
			});
			if (gen.status !== 0) throw new Error(`调色板生成失败：${group} / ${dir}`);

			const use = spawnSync(
				"ffmpeg",
				[
					...common,
					"-i",
					palette,
					"-filter_complex",
					"[0:v][1:v]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
					"-loop",
					"0",
					outFile,
				],
				{ stdio: "inherit" }
			);
			if (use.status !== 0) throw new Error(`GIF 合成失败：${group} / ${dir}`);

			console.log(`  GIF → docs/assets/${dir}/${group}.gif`);
		}
	}

	// 中间帧用完就删，别留在仓库里。
	for (const [group, byDir] of frames) {
		for (const dir of byDir.keys()) {
			rmSync(join(tmpRoot, `frames/${group}-${dir}`), { recursive: true, force: true });
		}
	}
}

// 顺手报告产物清单，方便核对。
const produced = [];
for (const dir of readdirSync(outRoot, { withFileTypes: true })) {
	if (!dir.isDirectory()) continue;
	for (const file of readdirSync(join(outRoot, dir.name))) produced.push(`${dir.name}/${file}`);
}
console.log(`\n完成，产物 ${produced.length} 个：`);
for (const file of produced.sort()) console.log(`  docs/assets/${file}`);
