/**
 * EasyQuiz 题库解析器（纯逻辑，不依赖 obsidian）。
 *
 * 解析流程：
 *   1. frontmatter → 文件是否题库文件、schemaVersion
 *   2. 标题扫描   → 按题面标题层级切分题目
 *   3. 题目解析   → 数据块 YAML + 题面结构（列表 / 表格 / 填空）
 *   4. 校验       → 按 `type` 校验结构，不符即降级并给出提示
 *
 * 所有问题都只降级当前这道题（`ok: false`），绝不影响同文件其它题目，绝不猜测答案。
 */

import {
	BlankMarkerMode,
	BlankRule,
	BlankSpec,
	BoardColumn,
	BoardItem,
	BoardPair,
	HistoryEntry,
	ParsedQuizFile,
	ParseWarning,
	QuizOption,
	QuizQuestion,
	QuizStats,
	QuizType,
} from "./types";
import { QUIZ_TYPES } from "./types";
import { listSeparator, t } from "./i18n";

export interface ParseDependencies {
	/** YAML 解析。插件中注入 obsidian 的 parseYaml，测试中注入 js-yaml。 */
	parseYaml: (source: string) => unknown;
	/** 计算题面哈希（同步）。 */
	hash: (input: string) => string;
}

export interface ParseOptions {
	/** 数据块语言标识，默认 `quiz`。 */
	blockLanguage?: string;
	/** 题面标题层级区间，默认 2–4。 */
	headingLevels?: [number, number];
	/** 允许的题库文件路径通配符；调用方先判定命中再传入。 */
	pathMatched?: boolean;
	/** Obsidian 汇总的全部标签（含 frontmatter tags 与正文 inline tag）。 */
	tags?: string[];
	/** 空位标记样式，默认只认 `==高亮==`。 */
	blankMarker?: BlankMarkerMode;
	deps: ParseDependencies;
}

export const DEFAULT_BLOCK_LANGUAGE = "quiz";
export const DEFAULT_HEADING_LEVELS: [number, number] = [2, 2];
export const DEFAULT_BLANK_MARKER: BlankMarkerMode = "highlight";

/** 作者可书写的字段；其余字段视为未知并提示。 */
const KNOWN_META_KEYS = new Set([
	"id",
	"type",
	"answer",
	"blanks",
	"shuffle",
	"explanation",
	"score",
	"stats",
	"rev",
	"history",
]);

const QUIZ_TAG = "#quiz";

const DEFAULT_STATS: QuizStats = {
	attempts: 0,
	correct: 0,
	lastResult: null,
	lastAt: null,
};

// ---------------------------------------------------------------------------
// 文本工具
// ---------------------------------------------------------------------------

function splitLines(text: string): string[] {
	return text.replace(/\r\n?/g, "\n").split("\n");
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*$/;

/**
 * 题面标题末尾的知识点链接：`^[[[知识点]]]`，也就是 `^[` 加一个 Obsidian 双链再加 `]`。
 *
 * `^[ … ]` 这层包装把双链标成题干的注记，而不是普通正文链接；里面的双链原样保留，
 * 因此它在 Obsidian 里仍然是真正的链接（点击可跳转、反链面板能找到这道题）。
 * 链接必须写在标题**末尾**：解析器把它当作固定后缀摘掉，不让它进入题面显示与派生 id。
 *
 * 旧写法 `^[[知识点]]` 仍然接受——插件 1.0 起的笔记不会因为升级而丢链接。
 * 捕获组 1 是新写法的目标，组 2 是旧写法的目标。
 */
export const KNOWLEDGE_LINK_AT_END = /\s*\^(?:\[\[\[([^\]\n]*)\]\]\]|\[\[([^\]\n]*)\]\])\s*$/;

/** 摘掉标题末尾的知识点链接，返回剩余标题与链接目标（没有链接时为 null）。 */
export function splitKnowledgeLink(title: string): { title: string; knowledgeLink: string | null } {
	const match = KNOWLEDGE_LINK_AT_END.exec(title);
	if (!match) return { title, knowledgeLink: null };
	return { title: title.slice(0, match.index).trimEnd(), knowledgeLink: match[1] ?? match[2] ?? null };
}

/** 只取标题文本（去掉末尾的知识点链接），用于显示与派生 id。 */
export function stripKnowledgeLink(title: string): string {
	return splitKnowledgeLink(title).title;
}

function normalizeText(markdown: string): string {
	return markdown
		.replace(/\s+/g, " ")
		.replace(/[*_`~]/g, "")
		.trim();
}

// ---------------------------------------------------------------------------
// 入口
// ---------------------------------------------------------------------------

/**
 * 解析一个题库文件。
 *
 * @param content 文件全文。
 * @param path 文件在 vault 中的路径（用于生成派生 id 与提示信息）。
 */
export function parseQuizFile(content: string, path: string, options: ParseOptions): ParsedQuizFile {
	const { deps } = options;
	const blockLanguage = options.blockLanguage ?? DEFAULT_BLOCK_LANGUAGE;
	const [minLevel, maxLevel] = options.headingLevels ?? DEFAULT_HEADING_LEVELS;

	const lines = splitLines(content);
	const warnings: ParseWarning[] = [];

	const { frontmatter, bodyStartLine } = parseFrontmatter(lines, deps, warnings);
	const tags = options.tags ?? [];
	const detected = detectQuizFile(frontmatter, tags, options.pathMatched === true);
	const blankMarker = options.blankMarker ?? DEFAULT_BLANK_MARKER;

	// 一次算出每行的围栏归属，标题扫描与题面解析共用，避免多处各写一份状态机。
	const fenceMap = buildFenceMap(lines);

	// 标题扫描：找出所有落在题面层级区间内的标题。
	// 规则：更深一级的标题只在「后面还有更浅的标题」时算子标题（该层级的分组用途），
	// 否则它本身就是一道题的题面。这样同一层级的标题始终能开新题。
	const candidates: { line: number; level: number; title: string }[] = [];
	for (let i = bodyStartLine; i < lines.length; i++) {
		const state = fenceMap[i];
		if (state && (state.kind === "open" || state.kind === "inside")) continue;
		const line = lines[i];
		if (line === undefined) continue;
		const match = HEADING_RE.exec(line);
		if (!match) continue;
		const level = match[1]?.length ?? 0;
		const title = match[2];
		if (title === undefined) continue;
		if (level < minLevel || level > maxLevel) continue;
		candidates.push({ line: i, level, title });
	}

	// 更深一级的标题若后面还有更浅的标题，则它是子标题，归入当前题的题面。
	const minimalLevelAfter: number[] = new Array<number>(candidates.length).fill(Number.MAX_SAFE_INTEGER);
	for (let index = candidates.length - 2; index >= 0; index--) {
		minimalLevelAfter[index] = Math.min(
			candidates[index + 1]?.level ?? Number.MAX_SAFE_INTEGER,
			minimalLevelAfter[index + 1] ?? Number.MAX_SAFE_INTEGER
		);
	}
	const headings = candidates.filter((heading, index) => (minimalLevelAfter[index] ?? 0) >= heading.level);

	// 每道题的结束行：到下一个同级或更高级标题为止。
	const rangeEnds: number[] = headings.map((heading, index) => {
		for (let n = index + 1; n < headings.length; n++) {
			const next = headings[n];
			if (next && next.level <= heading.level) return next.line;
		}
		return lines.length;
	});

	const questions: QuizQuestion[] = [];
	for (let h = 0; h < headings.length; h++) {
		const heading = headings[h];
		const endLine = rangeEnds[h];
		if (heading === undefined || endLine === undefined) continue;
		questions.push(
			parseQuestion({
				lines,
				fenceMap,
				heading,
				endLine,
				questionIndex: questions.length,
				path,
				blockLanguage,
				blankMarker,
				deps,
				warnings,
			})
		);
	}

	// 未被任何题面标题覆盖的 quiz 数据块：提示作者它不会被识别。
	for (let i = bodyStartLine; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const fence = matchFence(line);
		if (!fence || fence.language !== blockLanguage) continue;
		const covered = questions.some(
			(question, index) =>
				question.blockLine !== null &&
				question.blockLine >= (headings[index]?.line ?? -1) &&
				question.blockLine < (rangeEnds[index] ?? -1)
		);
		if (!covered) {
			warnings.push({
				code: "file",
				message: t("parser.blockOutsideStem", { line: i + 1, language: blockLanguage }),
				questionIndex: null,
				line: i,
			});
		}
	}

	return {
		fileIsQuiz: detected.by !== "none",
		detectedBy: detected.by,
		schemaVersion: readSchemaVersion(frontmatter),
		frontmatter,
		questions,
		warnings,
	};
}

// ---------------------------------------------------------------------------
// frontmatter
// ---------------------------------------------------------------------------

function parseFrontmatter(
	lines: string[],
	deps: ParseDependencies,
	warnings: ParseWarning[]
): { frontmatter: Record<string, unknown>; bodyStartLine: number } {
	if (lines[0]?.trim() !== "---") {
		return { frontmatter: {}, bodyStartLine: 0 };
	}
	let close = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			close = i;
			break;
		}
	}
	if (close < 0) {
		warnings.push({
			code: "file",
			message: t("parser.frontmatterUnclosed"),
			questionIndex: null,
			line: 0,
		});
		return { frontmatter: {}, bodyStartLine: 1 };
	}
	const source = lines.slice(1, close).join("\n");
	try {
		const parsed = deps.parseYaml(source);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return { frontmatter: parsed as Record<string, unknown>, bodyStartLine: close + 1 };
		}
		return { frontmatter: {}, bodyStartLine: close + 1 };
	} catch (error) {
		warnings.push({
			code: "yaml-error",
			message: t("parser.frontmatterYamlError", { error: errorMessage(error) }),
			questionIndex: null,
			line: 0,
		});
		return { frontmatter: {}, bodyStartLine: close + 1 };
	}
}

function readSchemaVersion(frontmatter: Record<string, unknown>): number | null {
	const value = frontmatter["schemaVersion"];
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function detectQuizFile(
	frontmatter: Record<string, unknown>,
	tags: string[],
	pathMatched: boolean
): { by: ParsedQuizFile["detectedBy"] } {
	const flag = frontmatter["quiz"];
	if (flag === true || flag === "true") return { by: "frontmatter-quiz" };
	const tagList = [...tags, ...toStringArray(frontmatter["tags"])];
	if (tagList.some((tag) => normalizeTag(tag) === QUIZ_TAG)) return { by: "tag" };
	if (pathMatched) return { by: "path-glob" };
	return { by: "none" };
}

function normalizeTag(tag: string): string {
	const trimmed = String(tag).trim();
	return trimmed.startsWith("#") ? trimmed : `#${trimmed}`;
}

function toStringArray(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
	return [];
}

// ---------------------------------------------------------------------------
// 围栏代码块
// ---------------------------------------------------------------------------

interface FenceInfo {
	marker: string;
	length: number;
	language: string;
	info: string;
}

function matchFence(line: string): FenceInfo | null {
	const match = /^\s*(`{3,}|~{3,})\s*([^\s`]*)\s*(.*)$/.exec(line);
	if (!match) return null;
	const markers = match[1] ?? "";
	const marker = markers.slice(0, 1);
	return { marker, length: markers.length, language: match[2] ?? "", info: match[3] ?? "" };
}

/**
 * 每行的围栏归属。`open` 为开围栏行，`close` 为闭围栏行，`inside` 为块内普通行，`none` 为块外。
 * 围栏规则（CommonMark）：闭围栏必须同种字符、长度不小于开围栏、且没有任何 info 字符串。
 */
type FenceKind = "none" | "open" | "close" | "inside";

interface FenceState {
	kind: FenceKind;
	/** 该行所属代码块的语言（`open` 行为自身语言，`inside`/`close` 为所属块语言）。 */
	language: string;
	/** 开围栏行号；块外为 -1。 */
	openLine: number;
}

/**
 * 一次扫描算出所有行的围栏归属，供标题扫描与题面解析共用。
 * 未闭合的代码块一直延伸到文件末尾（`close` 缺失）。
 */
function buildFenceMap(lines: string[]): FenceState[] {
	const map: FenceState[] = lines.map(() => ({ kind: "none", language: "", openLine: -1 }));
	let open: FenceInfo | null = null;
	let openLine = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const fence = matchFence(line);
		if (open === null) {
			if (fence) {
				open = fence;
				openLine = i;
				map[i] = { kind: "open", language: fence.language, openLine: i };
			}
			continue;
		}
		const isClose =
			fence !== null &&
			fence.marker === open.marker &&
			fence.length >= open.length &&
			fence.language === "" &&
			fence.info.trim() === "";
		if (isClose) {
			map[i] = { kind: "close", language: open.language, openLine };
			open = null;
			openLine = -1;
		} else {
			map[i] = { kind: "inside", language: open.language, openLine };
		}
	}
	return map;
}

/**
 * 找出以 `openLine` 开围栏的代码块的闭围栏行；没有闭围栏时返回 -1。
 */
function findBlockClose(fenceMap: FenceState[], openLine: number, limit: number): number {
	for (let i = openLine + 1; i < limit; i++) {
		const state = fenceMap[i];
		if (state === undefined) continue;
		if (state.kind === "close" && state.openLine === openLine) return i;
		if (state.kind === "open") return -1;
	}
	return -1;
}

// ---------------------------------------------------------------------------
// 围栏分析（供写回定位数据块使用）
// ---------------------------------------------------------------------------

/** 一行的围栏归属，见 {@link buildFenceMap}。 */
export type { FenceKind, FenceState };

/**
 * 分析每一行的围栏归属。写回时用它精确定位数据块边界，
 * 避免用正则去猜 ` ``` ` 的位置而误伤正文里的代码块。
 */
export function analyzeFences(lines: string[]): FenceState[] {
	return buildFenceMap(lines);
}

// ---------------------------------------------------------------------------
// 单题解析
// ---------------------------------------------------------------------------

interface QuestionContext {
	lines: string[];
	fenceMap: FenceState[];
	heading: { level: number; title: string; line: number };
	endLine: number;
	questionIndex: number;
	path: string;
	blockLanguage: string;
	/** 空位标记样式。 */
	blankMarker: BlankMarkerMode;
	deps: ParseDependencies;
	warnings: ParseWarning[];
}

function parseQuestion(ctx: QuestionContext): QuizQuestion {
	const { lines, fenceMap, heading, endLine, questionIndex, deps } = ctx;

	// 本题的所有提示都先收进 localCtx，最后统一带上 questionIndex 汇总。
	const warningsForQuestion: ParseWarning[] = [];
	const localCtx: QuestionContext = { ...ctx, warnings: warningsForQuestion };

	// 找到本题范围内的第一个数据块（只看开围栏行，闭围栏由 fenceMap 给出）。
	const dataBlocks: { open: number; close: number }[] = [];
	for (let i = heading.line + 1; i < endLine; i++) {
		const state = fenceMap[i];
		if (state === undefined || state.kind !== "open") continue;
		if (state.language !== ctx.blockLanguage) continue;
		dataBlocks.push({ open: i, close: findBlockClose(fenceMap, i, endLine) });
	}

	let blockStart = -1;
	let blockEnd = -1;
	let blockSource = "";
	const firstBlock = dataBlocks[0];
	if (firstBlock !== undefined) {
		blockStart = firstBlock.open;
		blockEnd = firstBlock.close;
		if (blockEnd < 0) {
			// 未闭合：内容取到本题末尾（不含 endLine 行），仍按 YAML 解析，作者能立刻看到提示。
			blockEnd = endLine;
			localCtx.warnings.push({
				code: "missing-block",
				message: t("parser.blockUnclosed"),
				questionIndex,
				line: blockStart,
			});
		}
		blockSource = lines.slice(blockStart + 1, blockEnd).join("\n");
	}

	// 题面正文 = 去掉数据块后的剩余部分（其它语言的代码块原样保留）。
	const bodyLines: string[] = [];
	for (let i = heading.line + 1; i < endLine; i++) {
		const state = fenceMap[i];
		const line = lines[i];
		if (state === undefined || line === undefined) continue;
		if (state.kind === "none") {
			bodyLines.push(line);
			continue;
		}
		// 该行所属代码块的语言由开围栏决定；`open` 行自身即开围栏。
		const owner = state.kind === "open" ? state : fenceMap[state.openLine];
		const ownerLanguage = owner?.language ?? "";
		if (ownerLanguage !== ctx.blockLanguage) bodyLines.push(line);
	}
	const body = trimBlankLines(bodyLines).join("\n");

	const meta = parseMetaBlock(blockSource, blockStart, localCtx);
	const structure = parseBodyStructure(body, heading.line + 1, localCtx);

	const type = resolveType(meta.rawType, blockStart, localCtx);
	const anchorCheck = resolveOptionAnchors(structure.options, type, localCtx);
	const resolvedAnswer = resolveAnswer(meta.rawAnswer, type, structure.options, localCtx);
	validateStructure(type, structure, resolvedAnswer, blockStart, localCtx);

	// 标题末尾的 `^[[[知识点]]]` 是溯源信息，不算题面文本：既不显示，也不参与派生 id。
	const headingTitle = splitKnowledgeLink(heading.title);
	const derived = deriveId(headingTitle.title);
	const id = meta.id ?? derived;
	const revNow = deps.hash(
		[type ?? "", body, structureHashSource(structure, meta)].join("\u0000")
	);
	const rev = typeof meta.rawRev === "string" ? meta.rawRev : null;

	const localWarnings = localCtx.warnings.map((warning) => ({ ...warning, questionIndex }));
	ctx.warnings.push(...localWarnings);

	// 只有"未知字段"是完全无害的提示；其余（含结构不符、锚点问题）都让该题不可作答。
	const ok = localWarnings.every((warning) => warning.code === "unknown-field");

	// 降级题不暴露可判分的答案：宁可让 UI 无从判分，也不给一个可能错的答案。
	const answer = ok ? resolvedAnswer : null;

	return {
		ok,
		type,
		id,
		idDerived: meta.id === null,
		title: headingTitle.title,
		knowledgeLink: headingTitle.knowledgeLink,
		level: heading.level,
		line: heading.line,
		body,
		blockLine: blockStart >= 0 ? blockStart : null,
		blockSource: blockStart >= 0 ? blockSource : null,
		options: structure.options,
		table: structure.table,
		tableHeader: structure.tableHeader,
		board: structure.board,
		boardPairs: structure.boardPairs,
		blanks: structure.blanks,
		answer,
		answerAnchors: ok ? anchorCheck : [],
		explanation: meta.explanation,
		score: meta.score,
		shuffle: meta.shuffle,
		blankRules: meta.blankRules,
		stats: meta.stats,
		history: meta.history,
		rev,
		revNow,
		stale: rev !== null && rev !== revNow,
		warnings: localWarnings,
	};
}

function trimBlankLines(lines: string[]): string[] {
	let start = 0;
	let end = lines.length;
	while (start < end && lines[start]?.trim() === "") start++;
	while (end > start && lines[end - 1]?.trim() === "") end--;
	return lines.slice(start, end);
}

function structureHashSource(
	structure: BodyStructure,
	meta: ReturnType<typeof parseMetaBlock>
): string {
	return [
		structure.options.map((o) => `${o.anchor ?? ""}:${normalizeText(o.markdown)}`).join("|"),
		// 用题板条目与正确连线，而不是表格原文：调整行顺序不应改变题面哈希。
		structure.board
			.map((column) => `${column.name}:${column.items.map((item) => item.text).join(",")}`)
			.join("|"),
		structure.boardPairs.map((pair) => `${pair.left}~${pair.right}`).join("|"),
		structure.blanks.map((b) => `${b.anchor}:${b.expected}`).join("|"),
		typeof meta.rawAnswer === "string" ? meta.rawAnswer : JSON.stringify(meta.rawAnswer ?? null),
		JSON.stringify(meta.blankRules),
	].join("\u0001");
}

function deriveId(title: string): string {
	const slug = title
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "-")
		.replace(/^-+|-+$/g, "");
	return slug === "" ? "question" : slug;
}

// ---------------------------------------------------------------------------
// 数据块
// ---------------------------------------------------------------------------

interface MetaBlock {
	rawType: unknown;
	rawAnswer: unknown;
	rawRev: unknown;
	id: string | null;
	explanation: string | null;
	score: number;
	shuffle: boolean;
	blankRules: Record<string, BlankRule>;
	stats: QuizStats;
	history: HistoryEntry[];
}

function parseMetaBlock(source: string, blockLine: number, ctx: QuestionContext): MetaBlock {
	const empty: MetaBlock = {
		rawType: null,
		rawAnswer: null,
		rawRev: null,
		id: null,
		explanation: null,
		score: 1,
		shuffle: false,
		blankRules: {},
		stats: { ...DEFAULT_STATS },
		history: [],
	};

	if (blockLine < 0) {
		ctx.warnings.push({
			code: "missing-block",
			message: t("parser.blockMissing", { language: ctx.blockLanguage }),
			questionIndex: null,
			line: ctx.heading.line,
		});
		return empty;
	}

	let parsed: unknown;
	try {
		parsed = ctx.deps.parseYaml(source);
	} catch (error) {
		ctx.warnings.push({
			code: "yaml-error",
			message: t("parser.blockYamlError", { error: errorMessage(error) }),
			questionIndex: null,
			line: blockLine,
		});
		return empty;
	}

	if (parsed === null || parsed === undefined) {
		ctx.warnings.push({
			code: "block-not-mapping",
			message: t("parser.blockEmpty"),
			questionIndex: null,
			line: blockLine,
		});
		return empty;
	}
	if (typeof parsed !== "object" || Array.isArray(parsed)) {
		ctx.warnings.push({
			code: "block-not-mapping",
			message: t("parser.blockNotMapping"),
			questionIndex: null,
			line: blockLine,
		});
		return empty;
	}

	const record = parsed as Record<string, unknown>;
	const presentKeys = Object.keys(record);

	for (const key of presentKeys) {
		if (!KNOWN_META_KEYS.has(key)) {
			ctx.warnings.push({
				code: "unknown-field",
				message: t("parser.unknownField", { key }),
				questionIndex: null,
				line: blockLine,
			});
		}
	}

	const meta: MetaBlock = {
		...empty,
		rawType: record["type"],
		rawAnswer: record["answer"],
		rawRev: record["rev"],
		id: typeof record["id"] === "string" && record["id"].trim() !== "" ? record["id"].trim() : null,
		explanation:
			typeof record["explanation"] === "string" && record["explanation"].trim() !== ""
				? record["explanation"].trim()
				: null,
		score: readScore(record["score"], blockLine, ctx),
		shuffle: record["shuffle"] === true,
		blankRules: readBlankRules(record["blanks"], blockLine, ctx),
		stats: readStats(record["stats"]),
		history: readHistory(record["history"]),
	};

	if (record["shuffle"] !== undefined && typeof record["shuffle"] !== "boolean") {
		ctx.warnings.push({
			code: "field-invalid",
			message: t("parser.shuffleInvalid"),
			questionIndex: null,
			line: blockLine,
		});
	}

	return meta;
}

function readScore(value: unknown, blockLine: number, ctx: QuestionContext): number {
	if (value === undefined) return 1;
	if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
	ctx.warnings.push({
		code: "field-invalid",
		message: t("parser.scoreInvalid"),
		questionIndex: null,
		line: blockLine,
	});
	return 1;
}

function readBlankRules(value: unknown, blockLine: number, ctx: QuestionContext): Record<string, BlankRule> {
	const rules: Record<string, BlankRule> = {};
	if (value === undefined || value === null) return rules;
	if (typeof value !== "object" || Array.isArray(value)) {
		ctx.warnings.push({
			code: "field-invalid",
			message: t("parser.blanksInvalid"),
			questionIndex: null,
			line: blockLine,
		});
		return rules;
	}
	for (const [anchor, raw] of Object.entries(value as Record<string, unknown>)) {
		if (raw === null || raw === undefined) {
			rules[anchor] = {};
			continue;
		}
		if (typeof raw !== "object" || Array.isArray(raw)) {
			ctx.warnings.push({
				code: "field-invalid",
				message: t("parser.blankRuleInvalid", { anchor }),
				questionIndex: null,
				line: blockLine,
			});
			continue;
		}
		const rule: BlankRule = {};
		const source = raw as Record<string, unknown>;
		if (typeof source["ignoreCase"] === "boolean") rule.ignoreCase = source["ignoreCase"];
		if (typeof source["regex"] === "boolean") rule.regex = source["regex"];
		if (Array.isArray(source["accept"])) {
			rule.accept = source["accept"].filter((item): item is string => typeof item === "string");
		}
		rules[anchor] = rule;
	}
	return rules;
}

function readStats(value: unknown): QuizStats {
	const stats: QuizStats = { ...DEFAULT_STATS };
	if (value === null || typeof value !== "object" || Array.isArray(value)) return stats;
	const record = value as Record<string, unknown>;
	if (typeof record["attempts"] === "number" && record["attempts"] >= 0) stats.attempts = record["attempts"];
	if (typeof record["correct"] === "number" && record["correct"] >= 0) stats.correct = record["correct"];
	if (record["lastResult"] === "correct" || record["lastResult"] === "wrong") {
		stats.lastResult = record["lastResult"];
	}
	if (typeof record["lastAt"] === "string") stats.lastAt = record["lastAt"];
	return stats;
}

function readHistory(value: unknown): HistoryEntry[] {
	if (!Array.isArray(value)) return [];
	const entries: HistoryEntry[] = [];
	for (const raw of value) {
		if (raw === null || typeof raw !== "object" || Array.isArray(raw)) continue;
		const record = raw as Record<string, unknown>;
		const result = record["result"];
		if (result !== "correct" && result !== "wrong") continue;
		const entry: HistoryEntry = { at: typeof record["at"] === "string" ? record["at"] : "", result };
		const answer = record["answer"];
		if (typeof answer === "string") entry.answer = answer;
		else if (Array.isArray(answer)) {
			entry.answer = answer.filter((item): item is string => typeof item === "string");
		}
		if (typeof record["ms"] === "number" && record["ms"] >= 0) entry.ms = record["ms"];
		entries.push(entry);
	}
	return entries;
}

// ---------------------------------------------------------------------------
// 题型
// ---------------------------------------------------------------------------

function resolveType(rawType: unknown, blockLine: number, ctx: QuestionContext): QuizType | null {
	if (rawType === undefined || rawType === null) {
		ctx.warnings.push({
			code: "type-missing",
			message: t("parser.typeMissing", { types: QUIZ_TYPES.join(" / ") }),
			questionIndex: null,
			line: blockLine,
		});
		return null;
	}
	if (typeof rawType !== "string" || !(QUIZ_TYPES as readonly string[]).includes(rawType)) {
		ctx.warnings.push({
			code: "type-invalid",
			message: t("parser.typeInvalid", {
				value: describeValue(rawType),
				types: QUIZ_TYPES.join(" / "),
			}),
			questionIndex: null,
			line: blockLine,
		});
		return null;
	}
	return rawType as QuizType;
}

// ---------------------------------------------------------------------------
// 题面结构
// ---------------------------------------------------------------------------

interface BodyStructure {
	options: QuizOption[];
	table: string[][] | null;
	tableHeader: string[] | null;
	tableStartLine: number;
	board: BoardColumn[];
	boardPairs: BoardPair[];
	blanks: BlankSpec[];
}

const LIST_ITEM_RE = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const ANCHOR_RE = /\s\^([A-Za-z0-9\-_]+)\s*$/m;
/** 空位的显式锚点：`==答案== ^b1` / `**答案** ^b1` 里的 `^b1`，可省略。 */
const BLANK_ANCHOR_RE = /\s*\^([A-Za-z0-9\-_]+)\s*$/;
/** 题板条目 key 前缀。 */
const ITEM_PREFIX = "i";

function parseBodyStructure(body: string, bodyStartLine: number, ctx: QuestionContext): BodyStructure {
	const lines = splitLines(body);
	const options: QuizOption[] = [];
	const tableRows: string[][] = [];
	let tableStartLine = -1;
	let inFence = false;
	let fenceMarker = "";

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line === undefined) continue;
		const fence = matchFence(line);
		if (fence) {
			if (!inFence) {
				inFence = true;
				fenceMarker = fence.marker;
			} else if (fence.marker === fenceMarker && fence.language === "") {
				inFence = false;
			}
			continue;
		}
		if (inFence) continue;

		const listMatch = LIST_ITEM_RE.exec(line);
		if (listMatch) {
			const raw = listMatch[1] ?? "";
			const anchorMatch = ANCHOR_RE.exec(raw);
			const anchor = anchorMatch?.[1] ?? null;
			const markdown = anchorMatch?.index !== undefined ? raw.slice(0, anchorMatch.index).trim() : raw.trim();
			options.push({ anchor, text: normalizeText(markdown), markdown });
			continue;
		}

		const row = parseTableRow(line);
		if (row) {
			if (isSeparatorRow(row)) continue;
			if (tableStartLine < 0) tableStartLine = bodyStartLine + i;
			tableRows.push(row);
		}
	}

	// 表格：首行为表头，其余为数据行。
	const header = tableRows[0];
	const hasTable = header !== undefined && tableRows.length >= 2;
	const knownColumns = header?.length ?? 0;
	const dataRows = hasTable
		? tableRows.slice(1).filter((row) => row.length === knownColumns)
		: [];
	const table = hasTable ? dataRows : null;

	const board = table && header ? buildBoardColumns(header, table) : [];
	const boardPairs = buildExpectedPairs(board);
	const blanks = collectBlanks(body, ctx.blankMarker);

	return {
		options,
		table,
		tableHeader: header ?? null,
		tableStartLine,
		board,
		boardPairs,
		blanks,
	};
}

function parseTableRow(line: string): string[] | null {
	const trimmed = line.trim();
	if (!trimmed.startsWith("|")) return null;
	const cells = trimmed.split("|");
	// 去掉首尾空串（行首行尾各一个 `|` 造成）。
	if (cells[0]?.trim() === "") cells.shift();
	if (cells[cells.length - 1]?.trim() === "") cells.pop();
	if (cells.length === 0) return null;
	return cells.map((cell) => cell.trim());
}

function isSeparatorRow(cells: string[]): boolean {
	return cells.every((cell) => /^:?-{2,}:?$/.test(cell.replace(/\s/g, "")));
}

/**
 * 由配对表格构造连线题板。
 *
 * - 每一列都有若干条目；连线只发生在**相邻两列**之间（第 1↔2、2↔3…），
 *   因此表格行顺序等价于一条从左到右的链：`A | B | C` 表示 A-B 与 B-C。
 * - 一个单元格就是一个条目，单元格内容**原样保留**：`MySQL / PostgreSQL` 里的
 *   斜杠只是文字，不会被拆成两个条目。
 * - 同一列内文本相同的条目合并为一个（否则题板上会出现两个文字相同的节点）；
 *   需要"一个条目对多个条目负责"时，靠重复表格行来表达。
 * - 条目 key 只由「列号 + 文本哈希」决定，与表格行顺序无关。
 */
function buildBoardColumns(header: string[], table: string[][]): BoardColumn[] {
	// 每一列：条目按文本去重。
	const columns: BoardColumn[] = header.map((name, columnIndex) => ({
		index: columnIndex,
		name,
		items: [],
		expected: [],
	}));
	const itemAt = new Map<string, BoardItem>(); // `${列号}|${文本}` → 条目
	const expected: BoardPair[] = [];
	const expectedKeys = new Set<string>();

	const itemFor = (columnIndex: number, text: string): BoardItem => {
		const lookup = `${columnIndex}|${text}`;
		const existing = itemAt.get(lookup);
		if (existing !== undefined) return existing;
		const item: BoardItem = {
			key: `${ITEM_PREFIX}${columnIndex}.${leftHash(text)}`,
			text,
			column: columnIndex,
		};
		itemAt.set(lookup, item);
		columns[columnIndex]?.items.push(item);
		return item;
	};

	const addPair = (from: BoardItem, to: BoardItem): void => {
		const [left, right] = from.column <= to.column ? [from, to] : [to, from];
		const key = `${left.key}~${right.key}`;
		if (expectedKeys.has(key)) return;
		expectedKeys.add(key);
		const pair: BoardPair = { left: left.key, right: right.key };
		expected.push(pair);
		columns[left.column]?.expected.push(pair);
	};

	// 逐行展开：每行的相邻列两两相连。单元格内容不再拆分——一格即一个条目。
	// 单元格已由 `parseTableRow` 去过首尾空白，因此这里直接用原值。
	for (const row of table) {
		for (let index = 0; index + 1 < header.length; index++) {
			const leftText = row[index] ?? "";
			const rightText = row[index + 1] ?? "";
			if (leftText === "" || rightText === "") continue;
			addPair(itemFor(index, leftText), itemFor(index + 1, rightText));
		}
	}

	// 表头重名（或为空）时给出可区分的名字，否则题板上会出现两个同名列。
	const seen = new Map<string, number>();
	for (const column of columns) {
		const base = column.name.trim() === "" ? t("parser.columnUnnamed", { index: column.index + 2 }) : column.name;
		const count = (seen.get(base) ?? 0) + 1;
		seen.set(base, count);
		column.name = count === 1 ? base : t("parser.columnGrouped", { base, count });
	}

	return columns;
}

/** 棋盘上所有正确答案（相邻列之间的连线）。 */
function buildExpectedPairs(columns: BoardColumn[]): BoardPair[] {
	return columns.flatMap((column) => column.expected);
}

/** 左侧文本的稳定哈希，用于生成不随行序变化的 key。 */
function leftHash(text: string): string {
	const source = normalizeText(text);
	let hash = 2166136261;
	for (let i = 0; i < source.length; i++) {
		hash ^= source.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16);
}

/**
 * 空位标记样式（`==高亮==` / `**加粗**`）。
 * 模式里带一个可选的尾部锚点 `^b1`：不写锚点时按出现顺序自动编号。
 */
const MARKER_PATTERNS: { mode: BlankMarkerMode; pattern: RegExp }[] = [
	{ mode: "highlight", pattern: /==([^=\n]+)==(\s*\^[A-Za-z0-9\-_]+)?/g },
	{ mode: "bold", pattern: /\*\*([^*\n]+)\*\*(\s*\^[A-Za-z0-9\-_]+)?/g },
];

/**
 * 收集题面里的空位，按出现顺序。
 *
 * - 标记样式由 `marker` 决定（`==…==` / `**…**` / 两者都识别）。
 * - 空位可以写显式锚点 `^b1`；**不写也完全可以**，此时按出现顺序自动编号为 `b1`、`b2`…
 *   （`blanks` 规则里要引用某个空位时才需要锚点）。
 * - 代码块与行内代码中的标记不算空位。
 */
function collectBlanks(body: string, marker: BlankMarkerMode): BlankSpec[] {
	const spans: { anchor: string; expected: string; index: number; length: number }[] = [];
	for (const { mode, pattern } of MARKER_PATTERNS) {
		if (marker !== "both" && marker !== mode) continue;
		const regex = new RegExp(pattern.source, "g");
		let match = regex.exec(body);
		while (match) {
			const expected = match[1];
			if (expected !== undefined) {
				// 锚点正则用局部实例：共享的带 `g` 正则会在多次 exec 之间带状态。
				const trailing = new RegExp(BLANK_ANCHOR_RE.source, "m").exec(match[0]);
				spans.push({
					anchor: trailing?.[1] ?? "",
					expected: expected.trim(),
					index: match.index,
					length: match[0].length,
				});
			}
			match = regex.exec(body);
		}
	}
	spans.sort((a, b) => a.index - b.index);

	const excluded = codeRanges(body);
	const blanks: BlankSpec[] = [];
	let auto = 0;
	for (const span of spans) {
		// 落在代码块 / 行内代码里的标记只是示例文字，不算空位。
		if (excluded.some(([start, end]) => span.index >= start && span.index < end)) continue;
		auto++;
		blanks.push({
			anchor: span.anchor === "" ? `b${auto}` : span.anchor,
			expected: span.expected,
			contextBefore: body.slice(Math.max(0, span.index - 40), span.index),
			contextAfter: body.slice(span.index + span.length, span.index + span.length + 40),
		});
	}
	return blanks;
}

/** 计算代码区域的字符区间：围栏代码块与行内代码。 */
function codeRanges(body: string): [number, number][] {
	const ranges: [number, number][] = [];
	const lines = body.split("\n");
	let offset = 0;
	let fenceStart = -1;
	let inFence = false;

	for (const line of lines) {
		const lineLength = line.length + 1;
		if (/^\s*(?:`{3,}|~{3,})/.test(line)) {
			if (!inFence) {
				inFence = true;
				fenceStart = offset;
			} else {
				inFence = false;
				ranges.push([fenceStart, offset + lineLength]);
			}
		} else if (!inFence) {
			// 行内代码：按反引号成对切分。
			let index = 0;
			while (index < line.length) {
				const open = line.indexOf("`", index);
				if (open < 0) break;
				const close = line.indexOf("`", open + 1);
				if (close < 0) break;
				ranges.push([offset + open, offset + close + 1]);
				index = close + 1;
			}
		}
		offset += lineLength;
	}
	if (inFence) ranges.push([fenceStart, body.length]);
	return ranges;
}

// ---------------------------------------------------------------------------
// 校验
// ---------------------------------------------------------------------------

/**
 * 选择题的选项锚点。
 *
 * 锚点可以省略：
 * - 全部选项都没写：按位置补 `a`、`b`、`c`…，因此 `answer: c` 仍然可用；
 * - 只写了一部分：保留显式锚点，没写锚点的选项在题卡中隐藏（anchor 仍为
 *   null），但整道题不因此降级。
 *
 * 只有选择题使用选项锚点；其它题型的列表只是普通正文，不应该被锚点校验打扰。
 */
function resolveOptionAnchors(options: QuizOption[], type: QuizType | null, ctx: QuestionContext): string[] {
	if (type !== "single" && type !== "multi") return [];

	if (options.every((option) => option.anchor === null)) {
		options.forEach((option, index) => {
			option.anchor = defaultOptionAnchor(index);
		});
	}

	const seen = new Set<string>();
	const anchors: string[] = [];
	for (const option of options) {
		if (option.anchor === null) continue;
		if (seen.has(option.anchor)) {
			ctx.warnings.push({
				code: "anchor-duplicate",
				message: t("parser.anchorDuplicate", { anchor: option.anchor }),
				questionIndex: null,
				line: null,
			});
			continue;
		}
		seen.add(option.anchor);
		anchors.push(option.anchor);
	}
	return anchors;
}

/** 缺省选项锚点：a…z，超过 26 个后按轮次编号为 a1、b1… */
function defaultOptionAnchor(index: number): string {
	const letter = String.fromCharCode(97 + (index % 26));
	const round = Math.floor(index / 26);
	return round === 0 ? letter : `${letter}${round}`;
}

function resolveAnswer(
	rawAnswer: unknown,
	type: QuizType | null,
	options: QuizOption[],
	ctx: QuestionContext
): string | string[] | null {
	if (type === "match" || type === "essay") {
		if (rawAnswer !== undefined) {
			ctx.warnings.push({
				code: "field-invalid",
				message:
					type === "match"
						? t("parser.answerIgnoredMatch")
						: t("parser.answerIgnoredEssay"),
				questionIndex: null,
				line: null,
			});
		}
		return null;
	}

	if (type === "blank") {
		if (rawAnswer === undefined) return null;
		ctx.warnings.push({
			code: "field-invalid",
			message: t("parser.answerIgnoredBlank"),
			questionIndex: null,
			line: null,
		});
		return null;
	}

	if (rawAnswer === undefined || rawAnswer === null) {
		if (type === "single" || type === "multi") {
			ctx.warnings.push({
				code: "field-invalid",
				message: t("parser.answerMissing"),
				questionIndex: null,
				line: null,
			});
		}
		return null;
	}

	if (type === "single") {
		if (typeof rawAnswer !== "string") {
			ctx.warnings.push({
				code: "field-invalid",
				message: t("parser.answerSingleInvalid"),
				questionIndex: null,
				line: null,
			});
			return null;
		}
		return rawAnswer.trim();
	}

	if (type === "multi") {
		if (!Array.isArray(rawAnswer) || rawAnswer.some((item) => typeof item !== "string")) {
			ctx.warnings.push({
				code: "field-invalid",
				message: t("parser.answerMultiInvalid"),
				questionIndex: null,
				line: null,
			});
			return null;
		}
		return (rawAnswer as string[]).map((item) => item.trim());
	}

	// type 为 null：保留原值供上层提示，但不参与判分。
	return typeof rawAnswer === "string" || Array.isArray(rawAnswer)
		? (rawAnswer as string | string[])
		: null;
}

function validateStructure(
	type: QuizType | null,
	structure: BodyStructure,
	answer: string | string[] | null,
	blockLine: number,
	ctx: QuestionContext
): void {
	const line = blockLine >= 0 ? blockLine : ctx.heading.line;
	if (type === null) return;

	const optionAnchors = new Set(
		structure.options.map((option) => option.anchor).filter((anchor): anchor is string => anchor !== null)
	);

	if (type === "single" || type === "multi") {
		if (structure.options.length < 2) {
			ctx.warnings.push({
				code: "structure-mismatch",
				message: t("parser.listTooFew", { type, count: structure.options.length }),
				questionIndex: null,
				line,
			});
			return;
		}
		if (type === "single" && typeof answer === "string" && !optionAnchors.has(answer)) {
			ctx.warnings.push({
				code: "field-invalid",
				message: t("parser.answerNoOption", { answer }),
				questionIndex: null,
				line,
			});
		}
		if (type === "multi" && Array.isArray(answer)) {
			const missing = answer.filter((item) => !optionAnchors.has(item));
			if (missing.length > 0) {
				ctx.warnings.push({
					code: "field-invalid",
					message: t("parser.answerAnchorsMissing", {
						anchors: missing.map((item) => `^${item}`).join(listSeparator()),
					}),
					questionIndex: null,
					line,
				});
			}
		}
		return;
	}

	if (type === "match") {
		if (!structure.table) {
			ctx.warnings.push({
				code: "structure-mismatch",
				message: t("parser.matchNoTable"),
				questionIndex: null,
				line,
			});
			return;
		}
		const columns = structure.table[0]?.length ?? 0;
		if (columns < 2) {
			ctx.warnings.push({
				code: "structure-mismatch",
				message: t("parser.matchTooFewColumns", { count: columns }),
				questionIndex: null,
				line,
			});
			return;
		}
		if (structure.boardPairs.length === 0) {
			ctx.warnings.push({
				code: "structure-mismatch",
				message: t("parser.matchNoPairs"),
				questionIndex: null,
				line,
			});
		}
		return;
	}

	if (type === "blank") {
		if (structure.blanks.length === 0) {
			ctx.warnings.push({
				code: "structure-mismatch",
				message: t("parser.blankNoMarker"),
				questionIndex: null,
				line,
			});
			return;
		}
		const anchors = structure.blanks.map((blank) => blank.anchor);
		const duplicated = anchors.filter((anchor, index) => anchors.indexOf(anchor) !== index);
		if (duplicated.length > 0) {
			ctx.warnings.push({
				code: "anchor-duplicate",
				message: t("parser.blankAnchorsDuplicate", {
					anchors: duplicated.map((item) => `^${item}`).join(listSeparator()),
				}),
				questionIndex: null,
				line,
			});
		}
		return;
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error) return error.message.split("\n")[0] ?? error.message;
	return String(error);
}

/** 把任意值转成可读文本，避免对象被拼成 `[object Object]`。 */
function describeValue(value: unknown): string {
	if (typeof value === "string") return value;
	if (value === null) return "null";
	if (value === undefined) return "undefined";
	switch (typeof value) {
		case "number":
		case "boolean":
		case "bigint":
			return `${value}`;
		case "symbol":
			return value.toString();
		default:
			return JSON.stringify(value) ?? "{}";
	}
}
