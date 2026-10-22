/**
 * 更新提示的版本判定与对话框。
 *
 * 版本判定是「升级才提示、同版不重复、降级不打扰」的闸门；对话框这一层
 * 则要保证这一版的每一条文案都真的出现在界面上，而不是只存在于数据表里。
 */

import { setupDom } from "./dom";

setupDom();

import { t } from "../src/i18n";
import { compareVersions, shouldAnnounce, whatsNewFor } from "../src/whats-new";
import type { WhatsNewEntry } from "../src/whats-new";
import { WhatsNewModal } from "../src/whats-new-modal";
import { assert, assertEqual, must, test } from "./harness";
import { ButtonComponent } from "./obsidian-stub";

/** 取某个版本的更新说明；测试里版本不存在本身就是失败。 */
function entryFor(version: string): WhatsNewEntry {
	const entry = whatsNewFor(version);
	if (entry === null) throw new Error(`${version} 应该有更新说明`);
	return entry;
}

test("版本比较：按数字比较，而不是按字符串", () => {
	assert(compareVersions("1.0.10", "1.0.9") > 0, "1.0.10 应该比 1.0.9 新");
	assertEqual(compareVersions("1.0.9", "1.0.9"), 0, "同一版本相等");
	assert(compareVersions("1.0.8", "1.0.9") < 0, "旧版本更小");
	assertEqual(compareVersions("v1.1", "1.1.0"), 0, "允许 v 前缀与省略的末段");
});

test("更新内容：只给登记过的版本准备说明", () => {
	const entry = entryFor("1.0.10");
	assertEqual(entry.version, "1.0.10", "说明的版本");
	assert(entry.changes.length > 0, "说明至少有一条文案");
	assertEqual(whatsNewFor("1.0.8"), null, "没有登记的版本返回 null");
});

test("更新提示：升级时提示一次，同版和降级不提示", () => {
	assert(shouldAnnounce(null, "1.0.10"), "没有版本记录时提示一次");
	assert(shouldAnnounce("1.0.9", "1.0.10"), "升级时提示");
	assert(!shouldAnnounce("1.0.10", "1.0.10"), "同一版本不重复提示");
	assert(!shouldAnnounce("1.0.10", "1.0.9"), "降级不提示");
	assert(!shouldAnnounce("1.0.8", "1.0.11"), "没有更新内容的版本保持安静");
});

test("更新对话框：列出这一版的每一条说明，并能关闭", () => {
	const entry = entryFor("1.0.10");
	const modal = new WhatsNewModal({} as never, entry);
	modal.open();

	const text = modal.contentEl.textContent ?? "";
	assert(text.includes("1.0.10"), "标题里要有版本号");
	for (const key of entry.changes) {
		assert(text.includes(t(key)), `对话框缺少文案：${key}`);
	}

	const setting = modal.contentEl.querySelector<HTMLElement & { setting?: { components: unknown[] } }>(
		".setting-item"
	);
	const button = setting?.setting?.components.find(
		(component): component is ButtonComponent => component instanceof ButtonComponent
	);
	const closeButton = must(button, "对话框缺少关闭按钮");
	assertEqual(closeButton.text, t("whatsNew.close"), "关闭按钮的文案");

	closeButton.click();
	assertEqual((modal as unknown as { isOpen: boolean }).isOpen, false, "点关闭后对话框应该收起");
});
