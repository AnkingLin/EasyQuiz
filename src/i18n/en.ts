/**
 * English messages. This table is the source of truth for message keys:
 * `zh.ts` is typed as a full `Record<MessageKey, string>`, so a missing or
 * misspelled Chinese string fails the type check instead of silently falling
 * back to English at runtime.
 *
 * Placeholders are written `{name}` and filled by `t(key, params)`.
 */

export const en = {
	// -----------------------------------------------------------------------
	// 通用
	// -----------------------------------------------------------------------
	/** Separator between items of one enumeration ("a, b, c"). */
	"common.listSeparator": ", ",
	/** Separator between two clauses of one message. */
	"common.clauseSeparator": "; ",

	// -----------------------------------------------------------------------
	// 题型
	// -----------------------------------------------------------------------
	"type.single": "Single choice",
	"type.multi": "Multiple choice",
	"type.match": "Matching",
	"type.blank": "Fill in the blank",
	"type.essay": "Short answer",
	"type.unknown": "Unknown",

	// -----------------------------------------------------------------------
	// 设置页
	// -----------------------------------------------------------------------
	"setting.language.name": "Interface language",
	"setting.language.desc":
		"Follows Obsidian, or pick a language. Command names and the ribbon tooltip update after a reload.",
	"setting.language.auto": "Follow Obsidian",
	"setting.blockLanguage.name": "Block language",
	"setting.blockLanguage.desc": "Fence language of the question data block. Reload Obsidian after changing it.",
	"setting.headingLevel.name": "Stem heading level",
	"setting.headingLevel.desc": "Which headings count as a question. Only H2 by default.",
	"setting.headingLevel.h2": "H2 (default)",
	"setting.headingMode.name": "Stem heading matching",
	"setting.headingMode.desc":
		"Fixed level uses the heading level above. Auto uses the closest heading that owns a data block, so group headings never become empty questions and any level can be a question.",
	"setting.headingMode.level": "Fixed level (default)",
	"setting.headingMode.auto": "Auto: nearest heading with a data block",
	"setting.pathGlobs.name": "Question-bank path globs",
	"setting.pathGlobs.desc":
		"One per line, e.g. banks/**. Matching notes are treated as question banks as well.",
	"setting.writeBack.name": "Write records back",
	"setting.writeBack.desc": "When off, grading happens in the UI only and note files are left untouched.",
	"setting.blankMarker.name": "Blank marker",
	"setting.blankMarker.desc":
		"Which Markdown marker creates a blank. The ^b1 anchor is optional; unwritten anchors are numbered by position.",
	"setting.blankMarker.highlight": "== highlight ==",
	"setting.blankMarker.bold": "** bold **",
	"setting.blankMarker.both": "Both",
	"setting.staleHint.name": "Show changed-question hint",
	"setting.staleHint.desc":
		"Show a note on a card when the stem changed after its revision was recorded. Dismissing it on a card turns this setting off.",
	"setting.historyLimit.name": "Per-question history cap",
	"setting.historyLimit.desc": "Records live in the note, so the detail list must be capped; 0 keeps the summary only.",

	// -----------------------------------------------------------------------
	// 命令、菜单、通知
	// -----------------------------------------------------------------------
	"command.refresh": "Refresh quiz view",
	"command.validate": "Validate current question bank",
	"command.openPractice": "Open practice window",
	"command.openPracticeTab": "Open practice window in a new tab",
	"command.openPracticePopout": "Open practice window in a new window",
	"command.insert": "Insert question",
	"command.practiceQuiz": "Practise this question bank",
	"menu.insert": "Insert question",
	"fileMenu.practice": "Practise this question bank",
	"notice.recorded": "Attempt recorded.",
	"notice.notQuizFile": "\"{name}\" is not a question bank (missing quiz: true or #quiz).",
	// 计数一律放在标签后面：英文没有量词，`1 questions` 这类写法会读起来是错的。
	"notice.validation": "Checked {total}: {ok} answerable, {bad} need fixing.",
	"notice.validationFileWarnings":
		"Checked {total}: {ok} answerable, {bad} need fixing; file-level warnings: {count}.",

	// -----------------------------------------------------------------------
	// 更新内容
	// -----------------------------------------------------------------------
	"whatsNew.title": "What's new in EasyQuiz {version}",
	"whatsNew.intro": "Highlights in this update:",
	"whatsNew.close": "Got it",
	"whatsNew.practicePlacement":
		"Open the practice window in a main-area tab, or in its own window on desktop, not just the sidebar; each location keeps its own round.",
	"whatsNew.progressBanner":
		"The progress banner stays pinned to the top of the practice page while the questions scroll.",
	"whatsNew.optionAnchors":
		"Choice-option anchors are optional: with none at all, options are numbered in order; with only some, the unanchored options are hidden.",
	"whatsNew.markdownEverywhere":
		"Stems, options, explanations and matching cells all render as Markdown, including bold, inline code, embedded images and formulas.",
	"whatsNew.compactPracticePage":
		"The practice page is tighter on phones: the repeated question title is gone from the progress row, and the header, banner and buttons take less room.",
	"whatsNew.autoHeading":
		"Stem headings can be matched automatically: choose Auto in settings and the closest heading that owns a data block becomes a question, at any heading level.",
	"whatsNew.nearestStem":
		"A card shows only the nearest paragraph, list or table as its stem: it is gathered upward from the type's target block, the adjacent block belongs to the stem, and farther blocks are crossed only when a blank line hugs a table. Prose attached to the options becomes supporting text, matching uses the nearest table, and an essay callout stays with the block above it.",
	"whatsNew.distractors":
		"Choice questions can add distractors: set how many to add and a pool of candidate options in the data block. A new question field can override the displayed stem.",
	"whatsNew.answerReview":
		"Going back to an answered question shows your own answer, and the stats badge reflects the new attempt. The header's edit button follows a native internal link to the question in its source note, reusing the tab if the note is already open.",
	"whatsNew.bankListFix":
		"The bank picker shows partial selection for folders and picks up file changes when you switch back, without a manual rescan.",
	"whatsNew.stemTighter":
		"Stems are gathered upward from each type's target block: the paragraph right above it is included, further up only blank lines hugging tables are skipped, and an ordinary blank line stops. Matching questions use only the nearest table, and an essay callout is shown together with the blocks above it. Stems render with Obsidian's Markdown rules — the containers carry markdown-rendered, so tables use the theme's styling.",
	"whatsNew.distractorReroll":
		"Distractors are redrawn after every attempt, and the review shows the set you answered with.",
	"whatsNew.clearRecords":
		"New Clear records buttons on the question and the bank reset attempts and history. The command palette can also start a round for the current bank.",
	"whatsNew.referenceById":
		"Reference a question from any note by writing its id as inline code, and the card is rendered in place.",
	"whatsNew.nativeEmbeds":
		"![[...]] embeds are no longer intercepted: images and section embeds render exactly as Obsidian does, and questions are referenced with their id as inline code.",
	"whatsNew.cardTitleLink":
		"In notes, a question card's title and pencil open the question's bank note at its heading, so the card itself is the way back to the source.",
	"whatsNew.noteJumpFix":
		"The card's edit button now opens the question's heading like a backlink: the cursor lands on the heading in edit mode, reading view scrolls there with the native highlight, and an already-open tab is reused.",
	"whatsNew.staleHintOff":
		"The changed-question hint can be switched off in settings; Dismiss on a card turns that setting off, so the warning colour disappears from every card.",
	"whatsNew.navRight":
		"Clear this question's records moved to the right-hand nav group, beside the jump box, so it no longer sits next to the submit area.",
	"whatsNew.aiSkill":
		"An authoring spec for AI agents ships in skills/easyquiz-authoring/SKILL.md: skeletons for the five question types, anchors, degrade rules and the knowledge-link convention. AI agents use it to add questions, repair banks and insert single questions into handouts; its examples are parsed and graded by the test suite.",

	// -----------------------------------------------------------------------
	// 诊断卡片（数据块渲染）
	// -----------------------------------------------------------------------
	"diagnostic.fileNotFound": "File not found; the question cannot be rendered.",
	"diagnostic.parseFailed": "Parse failed: {error}",
	"diagnostic.blockOutsideStem":
		"This block is not under any stem heading, so it cannot be rendered as a question. Move it under a heading.",

	// -----------------------------------------------------------------------
	// 题卡
	// -----------------------------------------------------------------------
	"card.knowledgePoint": "Knowledge point",
	"card.staleDismiss": "Dismiss",
	"card.submit": "Submit answer",
	"card.diagnostic.hint": "This question cannot be answered yet. Fix the data block and try again:",
	"card.diagnostic.incomplete": "Question data is incomplete.",
	"card.diagnostic.line": " (line {line})",
	"card.blank.label": "Blank {index}",
	"card.blank.aria": "Blank {anchor}",
	"card.match.tooFewColumns": "A matching table needs at least two columns before lines can be drawn.",
	"card.essay.placeholder": "Write your answer, then mark whether you have mastered it.",
	"card.essay.mastered": "Mastered",
	"card.essay.notMastered": "Not mastered",
	"card.feedback.submitFailed": "Submit failed: the question may have changed, or the data block cannot be written.",
	"card.feedback.recordedMastered": "Recorded: mastered",
	"card.feedback.recordedNotMastered": "Recorded: not mastered",
	"card.feedback.answerFirst": "Answer the question first.",
	"card.feedback.correct": "Correct",
	"card.feedback.wrong": "Wrong",
	"card.review.head": "Correct answer",
	"card.review.empty": "This question has no answer to compare against.",
	"card.review.explanation": "Explanation",
	"card.review.blank": "Blank {index}: {expected}",
	"card.review.essay": "Short answers are recorded by self-assessment; the reference answer is in the collapsed callout in the stem.",
	"card.review.yourAnswer": "Your answer",
	"card.review.noAnswer": "No answer was recorded for this attempt.",
	"card.review.blankAnswer": "Blank {index}: {value}",
	"card.review.essayMastered": "You marked this as mastered.",
	"card.review.essayNotMastered": "You marked this as not mastered yet.",

	// -----------------------------------------------------------------------
	// 题卡角标
	// -----------------------------------------------------------------------
	"stats.untried": "Not attempted",
	"stats.stale": "The stem changed; earlier records may not match this question exactly",

	// -----------------------------------------------------------------------
	// 插入题目模板（写入笔记的正文字样）
	// -----------------------------------------------------------------------
	"insert.title.single": "Single choice stem",
	"insert.title.multi": "Multiple choice stem",
	"insert.title.match": "Matching stem",
	"insert.title.blank": "Fill-in-the-blank stem",
	"insert.title.essay": "Short answer stem",
	"insert.option.placeholderA": "Option text ^a",
	"insert.option.placeholderB": "Option text ^b",
	"insert.table.headerLeft": "Left column",
	"insert.table.headerRight": "Right column",
	"insert.table.cellLeft": "Left item",
	"insert.table.cellRight": "Right item",
	"insert.blank.highlight": "==answer==",
	"insert.blank.bold": "**answer**",
	"insert.blank.stem": "Write the stem here, for example: the minimum TCP header length is {marker} bytes.",
	"insert.essay.stem": "Write the stem here.",
	"insert.essay.callout": "Reference answer",
	"insert.essay.answer": "Write the reference answer here.",

	// -----------------------------------------------------------------------
	// 插入题目对话框
	// -----------------------------------------------------------------------
	"insertModal.title": "Insert question",
	"insertModal.type.name": "Question type",
	"insertModal.type.desc":
		"Which skeleton to insert. The template shows the fields and the syntax; fill in the content afterwards.",
	"insertModal.stem.name": "Stem heading",
	"insertModal.stem.desc": "The heading level from the settings (H2 by default) is added automatically.",
	"insertModal.preview": "Preview",
	"insertModal.submit": "Insert",

	// -----------------------------------------------------------------------
	// 刷题窗口
	// -----------------------------------------------------------------------
	"practice.title": "Practice",
	"practice.step.list": "Question banks",
	"practice.step.settings": "Practice settings",
	"practice.step.practice": "Practice",
	"practice.mode.order": "In order",
	"practice.mode.random": "Random sample",
	"practice.mode.wrong": "Only wrong answers",
	"practice.mode.orderHint": "Walk through every question in file order; good for systematic review.",
	"practice.mode.randomHint": "Draw a random sample from the candidates; empty or 0 means all of them.",
	"practice.mode.wrongHint": "Only questions whose last attempt was wrong. With no records the round is empty.",
	"practice.renderFailed": "The practice window failed to render: {error}",
	"practice.list.heading": "Question-bank files",
	"practice.list.hint":
		"Every question-bank file in the vault, listed by path with its data. Search to narrow the list, fold a folder with its header, and tick several files to practise them in one round.",
	"practice.list.scanning": "Scanning question banks…",
	"practice.list.rootFolder": "/ (vault root)",
	"practice.list.matched": "Matched {count} question-bank files",
	"practice.list.noMatch": "No question-bank file matches \"{query}\".",
	"practice.list.foldAll": "Collapse all",
	"practice.list.unfoldAll": "Expand all",
	"practice.search.placeholder": "Search by file name or path",
	"practice.search.clear": "Clear the search",
	"practice.folder.files": "{count} files",
	"practice.folder.filesFiltered": "{count} / {total} files",
	"practice.folder.check": "Select every question bank in {folder}",
	"practice.folder.collapse": "Collapse {folder}",
	"practice.folder.expand": "Expand {folder}",
	"practice.totals.files": "Question-bank files: {count}",
	"practice.totals.questions": "Questions: {count}",
	"practice.totals.answerable": "Answerable: {count}",
	"practice.totals.broken": "Need fixing: {count}",
	"practice.totals.attempts": "Attempts: {count}",
	"practice.totals.accuracy": "Accuracy: {rate}",
	"practice.toolbar.selectAll": "Select all answerable",
	"practice.toolbar.clear": "Clear selection",
	"practice.toolbar.rescan": "Rescan",
	"practice.toolbar.startSetup": "Set up practice ({count} selected)",
	"practice.list.goSetup": "Set up this round",
	"practice.empty.none": "No question-bank files found.",
	"practice.empty.hintFrontmatter": "Add quiz: true to the note's frontmatter (recommended).",
	"practice.empty.hintTag": "Or give the file a #quiz tag.",
	"practice.empty.hintGlob": "Or add a path to \"Question-bank path globs\" in the settings, e.g. banks/**.",
	"practice.openSettings": "Open settings",
	"practice.file.parseFailed": "Parse failed: {error}",
	"practice.file.issues": "{count} to fix; those questions stay out of practice.",
	"practice.file.pick": "Practise this file",
	"practice.file.stats.total": "Questions: {count}",
	"practice.file.stats.answerable": "Answerable: {count}",
	"practice.file.stats.broken": "Need fixing: {count}",
	"practice.file.stats.noRecords": "No records",
	"practice.file.stats.lastAt": "Last {date}",
	"practice.file.clearRecords": "Clear records",
	"practice.clear.confirm": "Click again to clear",
	"practice.clear.doneFile": "Cleared {count} question(s) in this bank.",
	"practice.clear.doneQuestion": "Attempts for this question were cleared.",
	"practice.clear.failed": "Nothing to clear or the note could not be updated.",
	"practice.picker.heading": "Practice settings",
	"practice.picker.noFiles": "No question-bank file selected yet.",
	"practice.picker.back": "Back to question banks",
	"practice.picker.hint":
		"Choose what to practise and how to draw it. The number of questions in this round is shown before you start.",
	"practice.picker.chip": "{path} ({count} answerable)",
	"practice.picker.remove": "Remove {path}",
	"practice.picker.modeName": "How to draw questions",
	"practice.picker.randomCount": "Questions",
	"practice.picker.typeName": "Question types",
	"practice.picker.typeDesc":
		"No type ticked means all types; the number in brackets is how many answerable questions the selected files hold.",
	"practice.picker.typeLabel": "{label} ({count})",
	"practice.picker.shuffleName": "Shuffle",
	"practice.picker.shuffleDesc":
		"Shuffles the question order and the choice options; the columns of a matching question are always shuffled.",
	"practice.picker.start": "Start practice",
	"practice.count.available": "Answerable in the selected files: {count}",
	"practice.count.matching": "Matching the current filters: {count}",
	"practice.count.planned": "In this round: {count}",
	"practice.notice.empty": "No questions match the current settings: try another type or another way of drawing them.",
	"practice.session.finished": "This round is over.",
	"practice.session.backToList": "Back to question banks",
	"practice.session.end": "End round",
	"practice.session.index": "Question {index} of {total}",
	"practice.session.progress": "Correct {correct} · wrong {wrong} · answered {answered}",
	"practice.session.missing":
		"This question no longer exists (the file or its stem changed). Skip it, or start a new round.",
	"practice.session.cardFailed": "The card failed to render: {error}",
	"practice.session.prev": "Previous",
	"practice.session.next": "Next",
	"practice.session.results": "View results",
	"practice.session.peek": "Peek",
	"practice.session.jump": "Jump to question",
	"practice.session.openNote": "Open source note",
	"practice.session.openNoteFailed": "Could not open the source note: {error}",
	"practice.session.clearRecords": "Clear this question's records",
	"practice.summary.title": "Round results",
	"practice.summary.line":
		"{total} in this round · {answered} answered · {correct} correct · {wrong} wrong · {rate}% accuracy",
	"practice.summary.writeBackOff": "Record write-back is off, so this round was not written into the notes.",
	"practice.summary.wrongTitle": "Wrong this round",
	"practice.summary.wrongItem": "{title} (/{path})",
	"practice.summary.again": "Practise again",
	"practice.summary.retryWrong": "Retry wrong only",

	// -----------------------------------------------------------------------
	// 解析器提示
	// -----------------------------------------------------------------------
	"parser.frontmatterUnclosed": "Frontmatter is not closed (the closing --- is missing); it was ignored.",
	"parser.frontmatterYamlError": "Frontmatter YAML failed to parse: {error}",
	"parser.blockOutsideStem":
		"The `{language}` block on line {line} is not under any stem heading and will not be recognised.",
	"parser.blockUnclosed": "The data block is not closed (the closing ``` is missing); it was read to the end of the question.",
	"parser.blockMissing": "The `{language}` data block is missing, so the type cannot be determined (`type` is required).",
	"parser.blockYamlError": "Data block YAML failed to parse: {error}",
	"parser.blockEmpty": "The data block is empty; it needs at least a `type` field.",
	"parser.blockNotMapping": "The data block must be a key–value mapping (key: value).",
	"parser.unknownField": "Unknown field `{key}` was ignored.",
	"parser.shuffleInvalid": "`shuffle` must be true or false; it was treated as false.",
	"parser.scoreInvalid": "`score` must be a non-negative number; it was treated as 1.",
	"parser.blanksInvalid": "`blanks` must be a mapping of \"anchor: rule\"; it was ignored.",
	"parser.blankRuleInvalid": "`blanks.{anchor}` must be a rule object; that blank's rule was ignored.",
	"parser.questionInvalid": "`question` must be a non-empty string; the stem heading is shown instead.",
	"parser.distractorsInvalid": "`distractors` must be a count or `{ count, pool }`; it was ignored.",
	"parser.distractorsUnsupported": "`distractors` only applies to `single` and `multi` questions; it was ignored.",
	"parser.typeMissing": "The `type` field is missing, so the question type cannot be determined. Valid values: {types}.",
	"parser.typeInvalid": "`type: {value}` is not valid. Valid values: {types}.",
	"parser.columnUnnamed": "Column {index}",
	"parser.columnGrouped": "{base} (group {count})",
	"parser.anchorDuplicate": "Anchor `^{anchor}` is duplicated; grading will be unstable.",
	"parser.answerIgnoredMatch": "A matching question takes its answer from the table's row order; the `answer` field was ignored.",
	"parser.answerIgnoredEssay": "A short-answer question has no fixed answer; the `answer` field was ignored.",
	"parser.answerIgnoredBlank": "A blank question takes its answers from the `==…==` markers; the `answer` field was ignored.",
	"parser.answerMissing": "The `answer` field is missing, so this question cannot be graded.",
	"parser.answerSingleInvalid": "A single-choice `answer` must be one anchor string (e.g. `c`).",
	"parser.answerMultiInvalid": "A multiple-choice `answer` must be an array of anchors (e.g. `[a, b]`).",
	"parser.listTooFew": "`type: {type}` needs at least 2 bullet-list options in the stem; found {count}.",
	"parser.answerNoOption": "`answer: {answer}` does not match any option anchor.",
	"parser.answerAnchorsMissing": "These anchors in `answer` have no matching option: {anchors}.",
	"parser.matchNoTable": "`type: match` needs a table in the stem (a header row plus at least 1 data row).",
	"parser.matchTooFewColumns": "A matching table needs at least 2 columns; this one has {count}.",
	"parser.matchNoPairs": "The matching table has no adjacent-column items to connect.",
	"parser.blankNoMarker": "`type: blank` needs a blank such as `==answer== ^anchor` in the stem.",
	"parser.blankAnchorsDuplicate": "These blank anchors are duplicated: {anchors}.",

	// -----------------------------------------------------------------------
	// 判分说明
	// -----------------------------------------------------------------------
	"grade.notAnswerable": "Question \"{title}\" cannot be answered yet: {reasons}",
	"grade.unknownType": "Unknown question type; it cannot be graded.",
	"grade.choice.missing": "Missing: {anchors}",
	"grade.choice.extra": "Extra: {anchors}",
	"grade.anchorLabel": "{anchor} ({text})",
	"grade.blank.expected": "Blank {index} should be \"{expected}\"",
	"grade.match.missing": "Missing link: \"{left}\" — \"{right}\"",
	"grade.match.extra": "Extra link: \"{left}\" — \"{right}\"",
	"grade.essay.wrong": "Marked as not mastered",

	// -----------------------------------------------------------------------
	// 写回
	// -----------------------------------------------------------------------
	"writeback.invalidYaml": "The patched data block is not a valid YAML mapping, so the write was skipped to protect the note.",
} as const;

/** 所有消息键；`zh.ts` 必须完整覆盖它们。 */
export type MessageKey = keyof typeof en;

/** 一份完整的消息表（两种语言都必须覆盖全部键）。 */
export type MessageTable = Record<MessageKey, string>;
