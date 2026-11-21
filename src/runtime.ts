/**
 * Obsidian 适配层：把插件 API 注入纯逻辑解析器，并负责把题目写回文件。
 *
 * 纯逻辑部分（src/parser.ts、src/grade.ts、src/writeback.ts）不 import obsidian，
 * 因此可以在 node 下直接测试；这里集中处理所有 obsidian 依赖。
 */

import { App, parseYaml, TFile } from "obsidian";
import { parseQuizFile, ParseDependencies } from "./parser";
import { GradeResult, gradeAnswer, UserAnswer } from "./grade";
import { contentHash } from "./hash";
import { t } from "./i18n";
import { planClear, planWriteBack, replaceBlockInFile } from "./writeback";
import { HistoryEntry, ParsedQuizFile, QuizQuestion, QuizStats } from "./types";
import { DEFAULT_SETTINGS } from "./settings";
import type { RuntimeSettings } from "./settings";

export { contentHash };
export { DEFAULT_SETTINGS };
export type { RuntimeSettings };

export const parserDeps: ParseDependencies = {
	parseYaml: (source: string): unknown => parseYaml(source) as unknown,
	hash: contentHash,
};

/** 把 glob 片段里的普通字符转义成正则字面量。 */
function escapeRegex(text: string): string {
	return text.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}

/** 把 `题库/**` 这类通配符编译为可复用的匹配器。 */
export function compileGlob(glob: string): (path: string) => boolean {
	const normalized = glob.trim().replace(/\\/g, "/").replace(/^\/+/, "");
	if (normalized === "") return () => false;
	let pattern = "^";
	for (let index = 0; index < normalized.length; ) {
		const char = normalized[index] ?? "";
		if (char === "*" && normalized[index + 1] === "*") {
			let end = index + 2;
			while (normalized[end] === "*") end++;
			if (normalized[end] === "/") {
				// `**/` 匹配零级或更多级目录：`**/*.md` 也能命中根目录的 `a.md`。
				pattern += "(?:[^/]+/)*";
				index = end + 1;
			} else {
				pattern += ".*";
				index = end;
			}
			continue;
		}
		if (char === "*") {
			pattern += "[^/]*";
			index++;
			continue;
		}
		if (char === "?") {
			pattern += "[^/]";
			index++;
			continue;
		}
		pattern += escapeRegex(char);
		index++;
	}
	const regex = new RegExp(`${pattern}$`);
	return (path: string) => regex.test(path.replace(/\\/g, "/"));
}

/**
 * 题库文件解析服务：给出「这个文件是不是题库」以及「解析出的题目」。
 */
export class QuizService {
	/** 路径通配符只编译一次；设置变化时清空。 */
	private globCache = new Map<string, (path: string) => boolean>();

	constructor(
		private app: App,
		private settings: RuntimeSettings,
		/** 解析依赖；测试可注入与 Obsidian 一致的 YAML 解析器。 */
		private deps: ParseDependencies = parserDeps,
		/** 写回成功后的回调（插件用来避免自己触发的预览刷新冲掉复盘）。 */
		private onWriteBack?: (file: TFile) => void
	) {}

	updateSettings(settings: RuntimeSettings): void {
		this.settings = settings;
		this.globCache.clear();
	}

	/** 汇总 frontmatter tags 与正文 inline tag，供识别与解析共用。 */
	private collectTags(file: TFile): string[] {
		const cache = this.app.metadataCache.getFileCache(file);
		// Obsidian 的 frontmatter 是 `any`；先收成 Record 再按类型取值，避免把 any 扩散出去。
		const frontmatter: Record<string, unknown> | undefined = cache?.frontmatter;
		const frontmatterTags: unknown = frontmatter?.["tags"];
		return [
			...(cache?.tags?.map((tag) => tag.tag) ?? []),
			...(typeof frontmatterTags === "string" ? [frontmatterTags] : []),
			...(Array.isArray(frontmatterTags) ? frontmatterTags.filter((t): t is string => typeof t === "string") : []),
		];
	}

	private pathMatched(file: TFile): boolean {
		return this.settings.pathGlobs.some((glob) => {
			let matcher = this.globCache.get(glob);
			if (matcher === undefined) {
				matcher = compileGlob(glob);
				this.globCache.set(glob, matcher);
			}
			return matcher(file.path);
		});
	}

	private parseOptions(file: TFile, tags: string[]) {
		return {
			blockLanguage: this.settings.blockLanguage,
			headingLevels: this.settings.headingLevels,
			headingMode: this.settings.headingMode,
			blankMarker: this.settings.blankMarker,
			pathMatched: this.pathMatched(file),
			tags,
			deps: this.deps,
		};
	}

	/** 文件是否题库文件：frontmatter `quiz: true`、`#quiz` 标签，或路径通配符命中。 */
	isQuizFile(file: TFile): boolean {
		const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
		if (frontmatter?.["quiz"] === true || frontmatter?.["quiz"] === "true") return true;
		if (this.collectTags(file).some((tag) => (tag.startsWith("#") ? tag : `#${tag}`) === "#quiz")) return true;
		return this.pathMatched(file);
	}

	/** 解析整个文件。 */
	async parseFile(file: TFile): Promise<ParsedQuizFile> {
		const content = await this.app.vault.cachedRead(file);
		return parseQuizFile(content, file.path, this.parseOptions(file, this.collectTags(file)));
	}

	/** 按路径取出文件对象；路径不存在或不是文件时返回 null。 */
	fileAtPath(path: string): TFile | null {
		const file = this.app.vault.getAbstractFileByPath(path);
		return file instanceof TFile ? file : null;
	}

	/**
	 * 列出 vault 里全部题库文件（按路径排序）。
	 *
	 * 刷题窗口要"按文件路径展示所有题库文件"，所以这里主动扫一遍 Markdown 文件，
	 * 而不是等用户逐个打开——识别规则仍由 `isQuizFile` 单独决定，两处不会跑偏。
	 */
	listQuizFiles(): TFile[] {
		return this.app.vault
			.getMarkdownFiles()
			.filter((file) => this.isQuizFile(file))
			.sort((first, second) => first.path.localeCompare(second.path));
	}

	/**
	 * 判定并写回一条作答记录。
	 *
	 * 采用 `Vault.process`（原子读改写）：回调里用最新内容重新解析并定位数据块，
	 * 这样即使用户在作答期间改了文件，也不会覆盖他的修改。
	 */
	async submit(
		file: TFile,
		questionId: string,
		answer: UserAnswer,
		durationMs?: number
	): Promise<GradeResult | null> {
		const parsed = await this.parseFile(file);
		const question = parsed.questions.find((item) => item.id === questionId);
		if (!question || !question.ok) return null;

		const result = gradeAnswer(question, answer);
		if (!this.settings.writeBackEnabled) return result;
		try {
			result.written = await this.record(file, questionId, result, durationMs);
		} catch (error) {
			// 判分已经完成；写盘失败不能把结果吞掉，交给界面提示「已判分但未写入」。
			console.error("EasyQuiz: could not write the attempt record", error);
			result.written = false;
		}
		if (result.written) this.onWriteBack?.(file);
		return result;
	}

	private async record(
		file: TFile,
		questionId: string,
		result: GradeResult,
		durationMs?: number
	): Promise<boolean> {
		const historyEntry: HistoryEntry = {
			at: new Date().toISOString(),
			result: result.correct ? "correct" : "wrong",
			answer: result.recorded,
			...(durationMs !== undefined ? { ms: durationMs } : {}),
		};

		let written = false;
		await this.app.vault.process(file, (data) => {
			const parsed = parseQuizFile(data, file.path, {
				blockLanguage: this.settings.blockLanguage,
				headingLevels: this.settings.headingLevels,
				headingMode: this.settings.headingMode,
				blankMarker: this.settings.blankMarker,
				deps: this.deps,
			});
			const question = parsed.questions.find((item) => item.id === questionId);
			if (!question || question.blockLine === null || question.blockSource === null) return data;

			const stats: QuizStats = {
				attempts: question.stats.attempts + 1,
				correct: question.stats.correct + (result.correct ? 1 : 0),
				lastResult: result.correct ? "correct" : "wrong",
				lastAt: historyEntry.at,
			};
			const history = [...question.history, historyEntry];

			const patch = planWriteBack(
				question.blockSource,
				stats,
				history,
				question.revNow,
				{
					blockLanguage: this.settings.blockLanguage,
					headingLevels: this.settings.headingLevels,
					headingMode: this.settings.headingMode,
					deps: this.deps,
				},
				this.settings.historyLimit
			);
			if (!patch.applied) return data;

			const next = replaceBlockInFile(data, question.blockLine, patch.content, this.settings.blockLanguage);
			if (next === null) return data;
			written = true;
			return next;
		});
		return written;
	}

	/**
	 * 清除单道题的作答记录。
	 *
	 * 与写回共享同一套 `Vault.process` 约束：回调里按最新内容重新解析，从下往上
	 * 修改多个数据块，避免行号因为前面的删除而错位。
	 */
	async clearQuestionRecords(file: TFile, questionId: string): Promise<boolean> {
		let cleared = false;
		await this.app.vault.process(file, (data) => {
			const parsed = this.parseContent(data, file.path);
			const question = parsed.questions.find((item) => item.id === questionId);
			if (question === undefined) return data;
			const next = this.clearOne(data, question);
			if (next === null) return data;
			cleared = true;
			return next;
		});
		if (cleared) this.onWriteBack?.(file);
		return cleared;
	}

	/** 清除整个题库文件的作答记录，返回实际清除的题目数。 */
	async clearFileRecords(file: TFile): Promise<number> {
		let cleared = 0;
		await this.app.vault.process(file, (data) => {
			const parsed = this.parseContent(data, file.path);
			// 从文件末尾往前改：前面的数据块一旦变短，后面保存的行号依然有效。
			const targets = parsed.questions
				.filter((question) => question.blockLine !== null && question.blockSource !== null)
				.sort((first, second) => (second.blockLine ?? 0) - (first.blockLine ?? 0));
			let next = data;
			for (const question of targets) {
				const replaced = this.clearOne(next, question);
				if (replaced === null) continue;
				next = replaced;
				cleared += 1;
			}
			return next;
		});
		if (cleared > 0) this.onWriteBack?.(file);
		return cleared;
	}

	/** 用当前设置解析一段文件内容。 */
	private parseContent(content: string, path: string): ParsedQuizFile {
		return parseQuizFile(content, path, {
			blockLanguage: this.settings.blockLanguage,
			headingLevels: this.settings.headingLevels,
			headingMode: this.settings.headingMode,
			blankMarker: this.settings.blankMarker,
			deps: this.deps,
		});
	}

	/** 清除一道题在文件文本里的记录；没有可清的记录时返回 null。 */
	private clearOne(data: string, question: QuizQuestion): string | null {
		if (question.blockLine === null || question.blockSource === null) return null;
		if (!/^\s*(stats|history)\s*:/m.test(question.blockSource)) return null;
		const patch = planClear(question.blockSource, {
			blockLanguage: this.settings.blockLanguage,
			headingLevels: this.settings.headingLevels,
			headingMode: this.settings.headingMode,
			blankMarker: this.settings.blankMarker,
			deps: this.deps,
		});
		if (!patch.applied) return null;
		return replaceBlockInFile(data, question.blockLine, patch.content, this.settings.blockLanguage);
	}
}

/** 统计信息的人类可读摘要，用于题卡角标。 */
export function formatStats(question: QuizQuestion): string {
	const { attempts, correct } = question.stats;
	if (attempts === 0) return t("stats.untried");
	const rate = Math.round((correct / attempts) * 100);
	return `${correct}/${attempts} · ${rate}%`;
}

/** 数据块中是否记录了与当前题面不一致的 rev。 */
export function staleNote(question: QuizQuestion): string | null {
	return question.stale ? t("stats.stale") : null;
}
