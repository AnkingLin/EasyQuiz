/**
 * 「更新了什么」的内容表与版本判定（纯逻辑，不依赖 obsidian）。
 *
 * 每次值得让用户知道的更新在这里加一条，并在两份 README 的 What's new 里写
 * 同样的内容。插件加载时拿 manifest 的版本号来查这张表：当前版本没有条目就
 * 保持安静，因此小修补不必强行编一条更新说明。
 */

import type { MessageKey } from "./i18n";

export interface WhatsNewEntry {
	version: string;
	/** 这一版要展示的文案键；中英文案表各自负责翻译。 */
	changes: readonly MessageKey[];
}

/** 最新的版本在最前面。 */
export const WHATS_NEW: readonly WhatsNewEntry[] = [
	{
		version: "1.1.1",
		changes: ["whatsNew.stemTighter", "whatsNew.distractorReroll", "whatsNew.clearRecords"],
	},
	{
		version: "1.1.0",
		changes: [
			"whatsNew.autoHeading",
			"whatsNew.nearestStem",
			"whatsNew.distractors",
			"whatsNew.answerReview",
			"whatsNew.bankListFix",
		],
	},
	{
		version: "1.0.10",
		changes: ["whatsNew.markdownEverywhere", "whatsNew.compactPracticePage"],
	},
	{
		version: "1.0.9",
		changes: ["whatsNew.practicePlacement", "whatsNew.progressBanner", "whatsNew.optionAnchors"],
	},
];

/** 这一版的更新说明；没有就返回 null。 */
export function whatsNewFor(version: string): WhatsNewEntry | null {
	return WHATS_NEW.find((entry) => entry.version === version) ?? null;
}

/** 按点分数字比较版本：1.0.10 在 1.0.9 之后，而不是按字符串比较。 */
export function compareVersions(left: string, right: string): number {
	const a = versionParts(left);
	const b = versionParts(right);
	const length = Math.max(a.length, b.length);
	for (let index = 0; index < length; index++) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference;
	}
	return 0;
}

function versionParts(version: string): number[] {
	return version
		.replace(/^v/, "")
		.split(".")
		.map((part) => {
			const value = Number.parseInt(part, 10);
			return Number.isNaN(value) ? 0 : value;
		});
}

/**
 * 这次加载要不要提示更新内容。
 *
 * `previous` 为 null 表示 data.json 里还没有记录——可能是全新安装，也可能是
 * 从没有这个标记的旧版本升上来。两种情况都提示一次：旧版本的用户大多没改过
 * 设置，也没有 data.json，如果按「有记录才提示」判断，他们反而会错过。
 */
export function shouldAnnounce(previous: string | null, current: string): boolean {
	if (whatsNewFor(current) === null) return false;
	if (previous === null) return true;
	return compareVersions(current, previous) > 0;
}
