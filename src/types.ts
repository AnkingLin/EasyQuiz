/**
 * EasyQuiz 题目模型与解析结果类型。
 *
 * 设计原则（见 README §2）：
 * - 题型由 `type` 字段显式声明，绝不由内容形状推断；
 * - 任何解析问题都只降级当前这道题，不影响同文件其它题目，也绝不猜测答案。
 */

/** 支持的题型。`type` 字段的唯一合法取值集合。 */
export const QUIZ_TYPES = ["single", "multi", "match", "blank", "essay"] as const;

export type QuizType = (typeof QUIZ_TYPES)[number];

/**
 * 空位标记样式。
 * - `highlight`：`==答案==`（Obsidian 高亮语法）
 * - `bold`：`**答案**`
 * - `both`：两者都识别
 */
export type BlankMarkerMode = "highlight" | "bold" | "both";

/** 降级原因分类，便于 UI 给出针对性提示。 */
export type WarningCode =
	/** 未能解析出题目数据块 */
	| "missing-block"
	/** 数据块 YAML 语法错误 */
	| "yaml-error"
	/** 数据块不是键值映射 */
	| "block-not-mapping"
	/** `type` 字段缺失 */
	| "type-missing"
	/** `type` 取值非法 */
	| "type-invalid"
	/** 字段取值非法（如 answer/shuffle） */
	| "field-invalid"
	/** 未知字段，按忽略处理 */
	| "unknown-field"
	/** 题面结构与该题型不符 */
	| "structure-mismatch"
	/** 选择题选项缺少锚点 */
	| "option-unanchored"
	/** 锚点重复或与其它锚点冲突 */
	| "anchor-duplicate"
	/** 文件级提示 */
	| "file";

/** 一条解析提示。`questionIndex` 为在题目数组中的下标，文件级提示为 null。 */
export interface ParseWarning {
	code: WarningCode;
	message: string;
	questionIndex: number | null;
	/** 源码行号（0 基），未知时为 null。 */
	line: number | null;
}

/** 选择题 / 填空题 / 配对题共用的选项条目（已解析的正文文本）。 */
export interface QuizOption {
	/** 锚点；选择题必填，配对条目与填空空位为 null。 */
	anchor: string | null;
	/** 纯文本形式（用于匹配与记录）。 */
	text: string;
	/** 原始 Markdown 形式（用于渲染）。 */
	markdown: string;
}

/** 连线题板上的一个条目。 */
export interface BoardItem {
	/** 稳定 key：`i<列号>.<文本哈希>`，只依赖文本与列号，与行顺序无关。 */
	key: string;
	text: string;
	/** 所属列号（0 基）。 */
	column: number;
}

/** 连线题板的一列。 */
export interface BoardColumn {
	/** 列号，0 基。 */
	index: number;
	/** 列名，取自表头；重名或为空时会自动区分。 */
	name: string;
	/** 该列的条目（已按文本去重）。 */
	items: BoardItem[];
	/** 该列与右邻列之间的正确答案。 */
	expected: BoardPair[];
}

/** 一条正确的连线：相邻两列之间的两个条目。 */
export interface BoardPair {
	/** 左列条目的 key（列号较小者）。 */
	left: string;
	/** 右列条目的 key。 */
	right: string;
}
/** 一个填空空位。 */
export interface BlankSpec {
	/** 锚点（`^b1` 中的 `b1`）。 */
	anchor: string;
	/** 从 `==…==` 中取出的预期答案原文。 */
	expected: string;
	/** 空位周围的上下文，用于渲染。 */
	contextBefore: string;
	contextAfter: string;
}

/** 空位匹配规则。 */
export interface BlankRule {
	ignoreCase?: boolean;
	regex?: boolean;
	accept?: string[];
}

/** 题目数据块中由作者书写的字段。 */
export interface QuizMeta {
	/** 数据块中出现的原始字段集合，用于检测未知字段。 */
	presentKeys: string[];
	id: string | null;
	explanation: string | null;
	score: number;
	shuffle: boolean;
	blanks: Record<string, BlankRule>;
}

/** 由插件写入的字段。 */
export interface QuizStats {
	attempts: number;
	correct: number;
	lastResult: "correct" | "wrong" | null;
	lastAt: string | null;
}

export interface HistoryEntry {
	at: string;
	result: "correct" | "wrong";
	/** 选择题：所选锚点；填空题：用户输入。 */
	answer?: string | string[];
	ms?: number;
}

/** 一道题。解析成功时 `ok` 为 true；降级时 `ok` 为 false 且 `warnings` 说明原因。 */
export interface QuizQuestion {
	ok: boolean;
	type: QuizType | null;
	/** 稳定标识：`id` 字段，缺省时由标题路径派生。 */
	id: string;
	/** id 是否由标题派生（标题改名会导致记录失联）。 */
	idDerived: boolean;
	/** 题面标题文本（不含末尾的知识点链接）。 */
	title: string;
	/** 题面标题末尾 `^[[知识点]]` 里的链接目标；没写时为 null。 */
	knowledgeLink: string | null;
	/** 题面标题层级（1–6）。 */
	level: number;
	/** 题面标题所在行号（0 基）。 */
	line: number;
	/** 题面正文（不含标题行、不含数据块）。 */
	body: string;
	/** 数据块所在行号（0 基），仅起始围栏行。 */
	blockLine: number | null;
	/** 数据块原始源码。 */
	blockSource: string | null;

	options: QuizOption[];
	table: string[][] | null;
	tableHeader: string[] | null;
	/** 连线题板：每一列及其条目。 */
	board: BoardColumn[];
	/** 全部正确答案（相邻列之间的连线）。 */
	boardPairs: BoardPair[];
	blanks: BlankSpec[];

	answer: string | string[] | null;
	answerAnchors: string[];
	explanation: string | null;
	score: number;
	shuffle: boolean;
	/** 每个空位的匹配规则，键为空位锚点。缺省的空位按 strict 处理。 */
	blankRules: Record<string, BlankRule>;

	stats: QuizStats;
	history: HistoryEntry[];
	/** 写入时的题面哈希；用于检测题目被改动。 */
	rev: string | null;
	/** 当前题面算出的哈希，与 `rev` 不一致即表示题面已变更。 */
	revNow: string;
	/** `rev` 存在且与 `revNow` 不一致。 */
	stale: boolean;

	warnings: ParseWarning[];
}

/** 文件级解析结果。 */
export interface ParsedQuizFile {
	/** 是否被识别为题库文件。 */
	fileIsQuiz: boolean;
	/** 识别依据，便于设置页展示与排查。 */
	detectedBy: "frontmatter-quiz" | "tag" | "path-glob" | "none";
	schemaVersion: number | null;
	frontmatter: Record<string, unknown>;
	questions: QuizQuestion[];
	warnings: ParseWarning[];
}
