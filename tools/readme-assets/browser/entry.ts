/**
 * 浏览器入口：生成全部 README 场景。
 *
 * 流程由 `generate.mjs` 驱动，分两个模式：
 *
 *   `?list=1`            —— 只输出场景清单（JSON），用来枚举产物。
 *   `?scene=X&dir=Y`     —— 渲染该场景，并把真实高度 / 宽度 / 表单值写进
 *                           `<html>` 的 data 属性，供脚本用 `--dump-dom` 读回。
 *
 * 之所以要"先量后截"：headless 的 `--screenshot` 尺寸由启动参数 `--window-size`
 * 决定，而场景高度只有渲染完才知道。
 */

import { buildScene, sceneManifest } from "./scenes";

/** 把场景元素挂进 stage，并按场景宽度 / 主题设置外框。 */
function mount(element: HTMLElement, width: number, theme: string): void {
	const stage = document.getElementById("stage");
	if (stage === null) throw new Error("缺少 #stage 容器");
	stage.replaceChildren();
	stage.className = `theme-${theme}`;
	stage.style.width = `${width}px`;

	const shot = document.createElement("div");
	shot.className = "eq-shot";
	shot.appendChild(element);
	stage.appendChild(shot);
}

async function main(): Promise<void> {
	const params = new URLSearchParams(location.search);
	const list = document.getElementById("list");
	const ready = (state: string): void => document.documentElement.setAttribute("data-ready", state);

	// 清空工作台（场景构建期间会临时把节点挂在这里）。
	document.getElementById("workbench")?.replaceChildren();

	// 列举模式：把清单交给脚本。
	if (params.get("list") === "1") {
		if (list !== null) list.textContent = JSON.stringify(sceneManifest());
		ready("1");
		return;
	}

	const name = params.get("scene");
	const dir = params.get("dir") ?? "en";
	if (name === null) {
		ready("error");
		if (list !== null) {
			list.hidden = false;
			list.textContent = "Scene error: missing ?scene= parameter";
		}
		return;
	}

	try {
		// `index` 用来区分同一场景的多帧（动画）；静态场景恒为 0。
		const parsedIndex = Number.parseInt(params.get("index") ?? "0", 10);
		const index = Number.isFinite(parsedIndex) ? parsedIndex : 0;
		const built = await buildScene(name, dir, index);
		if (built === undefined) throw new Error(`没有场景 ${name} / ${dir}${index === 0 ? "" : ` / #${index}`}`);
		mount(built.element, built.info.width, built.info.theme);

		// 让字体与 SVG 布局稳定下来，再量尺寸。
		await new Promise((resolve) => window.setTimeout(resolve, 150));

		// 截图时脚本会把真实高度传回来；写在 #stage 上保证底部不会多出空白。
		const height = Number.parseInt(params.get("height") ?? "", 10);
		if (Number.isFinite(height)) {
			const stage = document.getElementById("stage");
			if (stage !== null) stage.style.minHeight = `${height}px`;
			await new Promise((resolve) => window.setTimeout(resolve, 30));
		}

		const root = document.documentElement;
		// 高度：脚本据此决定第二遍截图的视口。
		root.setAttribute("data-scene-height", String(root.scrollHeight));
		// 宽度：内容横向溢出时截图右侧会被切掉，脚本据此报警。
		root.setAttribute("data-scene-width", String(root.scrollWidth));

		// 表单控件的 `.value` / `.checked` 是 IDL 属性，`--dump-dom` 看不到。
		// 镜像到 data 属性上，生成器才能验证"输入框真的被填了值"。
		for (const input of Array.from(document.querySelectorAll<HTMLInputElement>("input"))) {
			input.setAttribute("data-value", input.value);
			input.setAttribute("data-checked", input.checked ? "1" : "0");
		}
		for (const select of Array.from(document.querySelectorAll<HTMLSelectElement>("select"))) {
			select.setAttribute("data-value", select.value);
		}

		ready("1");
	} catch (error) {
		// 失败原因写到 DOM 上：headless 流程只看得到 DOM（控制台消息会被日志噪声淹没）。
		ready("error");
		if (list !== null) {
			list.hidden = false;
			list.textContent = `SCENE-ERROR: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`;
		}
	}
}

void main();
