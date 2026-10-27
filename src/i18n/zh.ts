/**
 * 中文文案。键与 `en.ts` 一一对应：类型是 `MessageTable`，少写或多写一个键都会
 * 在 `tsc` 阶段报错，因此不会出现"运行时悄悄回落成英文"的漏译。
 */

import type { MessageTable } from "./en";

export const zh: MessageTable = {
	// -----------------------------------------------------------------------
	// 通用
	// -----------------------------------------------------------------------
	"common.listSeparator": "、",
	"common.clauseSeparator": "；",

	// -----------------------------------------------------------------------
	// 题型
	// -----------------------------------------------------------------------
	"type.single": "单选",
	"type.multi": "多选",
	"type.match": "配对",
	"type.blank": "填空",
	"type.essay": "问答",
	"type.unknown": "未知",

	// -----------------------------------------------------------------------
	// 设置页
	// -----------------------------------------------------------------------
	"setting.language.name": "界面语言",
	"setting.language.desc": "跟随 Obsidian，或手动指定。命令面板里的命令名与丝带图标的提示会在重新加载后更新。",
	"setting.language.auto": "跟随 Obsidian",
	"setting.blockLanguage.name": "数据块语言",
	"setting.blockLanguage.desc": "题目数据块使用的围栏语言。改动后需要重新加载 Obsidian。",
	"setting.headingLevel.name": "题面标题层级",
	"setting.headingLevel.desc": "决定哪些标题被当作一道题。默认只认二级标题。",
	"setting.headingLevel.h2": "H2（默认）",
	"setting.headingMode.name": "题面标题匹配方式",
	"setting.headingMode.desc":
		"固定层级按上面的标题层级识别题目。自动匹配会取「自己这一段里有数据块」的最近标题，任何层级都能成题，分组标题也不会变成空题。",
	"setting.headingMode.level": "固定层级（默认）",
	"setting.headingMode.auto": "自动：最近的带数据块标题",
	"setting.pathGlobs.name": "题库路径通配符",
	"setting.pathGlobs.desc": "每行一条，例如 题库/**。命中的文件也会被当作题库。",
	"setting.writeBack.name": "记录写回",
	"setting.writeBack.desc": "关闭后只在界面上判分，不会修改笔记文件。",
	"setting.blankMarker.name": "填空标记",
	"setting.blankMarker.desc": "填空题用哪种 Markdown 标记挖空。空位锚点 ^b1 可以省略，省略时按出现顺序自动编号。",
	"setting.blankMarker.highlight": "== 高亮 ==",
	"setting.blankMarker.bold": "** 加粗 **",
	"setting.blankMarker.both": "两者都识别",
	"setting.historyLimit.name": "单题历史条数上限",
	"setting.historyLimit.desc": "记录写在笔记内，必须有上限；0 表示只保留汇总。",

	// -----------------------------------------------------------------------
	// 命令、菜单、通知
	// -----------------------------------------------------------------------
	"command.refresh": "刷新题库视图",
	"command.validate": "校验当前题库文件",
	"command.openPractice": "打开刷题窗口",
	"command.openPracticeTab": "在新标签页打开刷题窗口",
	"command.openPracticePopout": "在新窗口打开刷题窗口",
	"command.insert": "插入题目",
	"command.practiceQuiz": "刷这个题库",
	"menu.insert": "插入题目",
	"fileMenu.practice": "刷这个题库",
	"notice.recorded": "已记录本次作答。",
	"notice.notQuizFile": "「{name}」不是题库文件（缺少 quiz: true 或 #quiz）。",
	"notice.validation": "共 {total} 道题：可作答 {ok}，需修正 {bad}。",
	"notice.validationFileWarnings": "共 {total} 道题：可作答 {ok}，需修正 {bad}，文件级提示 {count} 条。",

	// -----------------------------------------------------------------------
	// 更新内容
	// -----------------------------------------------------------------------
	"whatsNew.title": "EasyQuiz {version} 更新内容",
	"whatsNew.intro": "这次更新包括：",
	"whatsNew.close": "知道了",
	"whatsNew.practicePlacement": "刷题窗口除了右侧边栏，还能开在主区域的标签页，桌面端还能开独立窗口；每个位置各保留一轮。",
	"whatsNew.progressBanner": "刷题页滚动时，进度条固定在页面顶部。",
	"whatsNew.optionAnchors": "选择题选项的锚点可以省略：一个都没写时按顺序自动编号，只写了一部分时没锚点的选项会从题卡隐藏。",
	"whatsNew.markdownEverywhere": "题面、选项、解析和配对单元格都按 Markdown 渲染，加粗、行内代码、内嵌图片和公式都能正常显示。",
	"whatsNew.compactPracticePage": "刷题页在手机上更紧凑：进度行不再重复题目标题，页头、进度条和按钮占的地方也更少。",
	"whatsNew.autoHeading": "题面标题可以自动匹配：在设置里选“自动”，自己这一段里有数据块的最近标题就是一道题，任何层级都行。",
	"whatsNew.nearestStem": "题卡只把最近的一段文字、列表或表格当作题面；紧贴在选项或表格上方、中间没有空行的文字作为补充内容显示，更远的段不再纳入。",
	"whatsNew.distractors": "选择题可以在数据块里加干扰项：设置追加几个，以及候选干扰项的候选池。",
	"whatsNew.answerReview": "切回已答过的题会显示你当时的作答，右上角统计也会跟着更新；新增“打开笔记”按钮，直接跳到题库里的这道题，笔记已经打开时会切到原来的标签页。",
	"whatsNew.bankListFix": "题库选择页的文件夹会显示半选状态；从其他页面切回来时自动发现文件变化，不用再手动重新扫描。",
	"whatsNew.stemTighter": "题面按最近的一段整体取：选择题里贴着选项上方的说明文字作为补充内容；表格上下的空行不再打断同一段结构，多张表可以合并成一道配对题。",
	"whatsNew.distractorReroll": "每次作答后干扰项都会重新抽取，复盘时看到的是作答当时那一组。",
	"whatsNew.clearRecords": "题目卡片和题库列表新增“清除记录”按钮，可以清掉本题或整个题库的作答记录；命令面板也能直接为当前题库开始一轮。",

	// -----------------------------------------------------------------------
	// 诊断卡片（数据块渲染）
	// -----------------------------------------------------------------------
	"diagnostic.fileNotFound": "找不到文件，无法渲染题目。",
	"diagnostic.parseFailed": "解析失败：{error}",
	"diagnostic.blockOutsideStem": "这个数据块不属于任何题面标题，无法渲染为题目。请把它放到某个标题之下。",
	"diagnostic.embedNotFound": "找到了这个标题，但没能从它下面解析出可作答的题目。请检查该题的数据块。",

	// -----------------------------------------------------------------------
	// 题卡
	// -----------------------------------------------------------------------
	"card.knowledgePoint": "知识点",
	"card.submit": "提交答案",
	"card.diagnostic.hint": "这道题暂时不能作答，请修正数据块后重试：",
	"card.diagnostic.incomplete": "题目数据不完整。",
	"card.diagnostic.line": "（第 {line} 行）",
	"card.blank.label": "第 {index} 空",
	"card.blank.aria": "填空 {anchor}",
	"card.match.tooFewColumns": "配对表格至少需要两列才能连线。",
	"card.essay.placeholder": "写下你的答案，再自评是否掌握。",
	"card.essay.mastered": "已掌握",
	"card.essay.notMastered": "未掌握",
	"card.feedback.submitFailed": "提交失败：题目可能已被修改或数据块无法写入。",
	"card.feedback.recordedMastered": "已记录：掌握",
	"card.feedback.recordedNotMastered": "已记录：未掌握",
	"card.feedback.answerFirst": "请先作答。",
	"card.feedback.correct": "回答正确",
	"card.feedback.wrong": "回答错误",
	"card.review.head": "正确答案",
	"card.review.empty": "这道题没有可对照的答案。",
	"card.review.explanation": "解析",
	"card.review.blank": "第 {index} 空：{expected}",
	"card.review.essay": "问答题按自评记录，参考答案见题面中的折叠标注。",
	"card.review.yourAnswer": "你的作答",
	"card.review.noAnswer": "这次没有记录到作答内容。",
	"card.review.blankAnswer": "第 {index} 空：{value}",
	"card.review.essayMastered": "你标记为：已掌握",
	"card.review.essayNotMastered": "你标记为：还没掌握",

	// -----------------------------------------------------------------------
	// 题卡角标
	// -----------------------------------------------------------------------
	"stats.untried": "未作答",
	"stats.stale": "题面已变更，历史记录可能与当前题目不完全对应",

	// -----------------------------------------------------------------------
	// 插入题目模板（写入笔记的正文字样）
	// -----------------------------------------------------------------------
	"insert.title.single": "单选题干",
	"insert.title.multi": "多选题干",
	"insert.title.match": "配对题干",
	"insert.title.blank": "填空题干",
	"insert.title.essay": "问答题干",
	"insert.option.placeholderA": "选项内容 ^a",
	"insert.option.placeholderB": "选项内容 ^b",
	"insert.table.headerLeft": "左列",
	"insert.table.headerRight": "右列",
	"insert.table.cellLeft": "左侧内容",
	"insert.table.cellRight": "右侧内容",
	"insert.blank.highlight": "==答案==",
	"insert.blank.bold": "**答案**",
	"insert.blank.stem": "这里是题干，例如：TCP 首部的最小长度是 {marker} 字节。",
	"insert.essay.stem": "在这里写出题干。",
	"insert.essay.callout": "参考答案",
	"insert.essay.answer": "在这里写出参考答案。",

	// -----------------------------------------------------------------------
	// 插入题目对话框
	// -----------------------------------------------------------------------
	"insertModal.title": "插入题目",
	"insertModal.type.name": "题型",
	"insertModal.type.desc": "决定插入哪种题目的骨架。字段与语法由模板给出，插入后再填内容。",
	"insertModal.stem.name": "题干标题",
	"insertModal.stem.desc": "会自动加上设置里的标题层级（默认二级）。",
	"insertModal.preview": "预览",
	"insertModal.submit": "插入",

	// -----------------------------------------------------------------------
	// 刷题窗口
	// -----------------------------------------------------------------------
	"practice.title": "刷题",
	"practice.step.list": "题库列表",
	"practice.step.settings": "刷题设置",
	"practice.step.practice": "刷题",
	"practice.mode.order": "顺序刷题",
	"practice.mode.random": "定量随机抽题",
	"practice.mode.wrong": "只刷错题",
	"practice.mode.orderHint": "按文件里的题目顺序逐题过一遍，适合系统复习。",
	"practice.mode.randomHint": "从候选题里随机抽出指定数量，留空或填 0 表示全部。",
	"practice.mode.wrongHint": "只抽上一次作答错误的题。没有记录时这一轮会是空的。",
	"practice.renderFailed": "刷题窗口渲染失败：{error}",
	"practice.list.heading": "题库文件",
	"practice.list.hint": "按文件路径列出 vault 里的题库文件及其数据。可以用搜索缩小范围、点文件夹标题折叠，勾选多份可以合并成一轮练习。",
	"practice.list.scanning": "正在扫描题库…",
	"practice.list.rootFolder": "/（vault 根目录）",
	"practice.list.matched": "匹配到 {count} 个题库文件",
	"practice.list.noMatch": "没有题库文件匹配「{query}」。",
	"practice.list.foldAll": "全部折叠",
	"practice.list.unfoldAll": "全部展开",
	"practice.search.placeholder": "搜索文件名或路径",
	"practice.search.clear": "清空搜索",
	"practice.folder.files": "{count} 个文件",
	"practice.folder.filesFiltered": "{count} / {total} 个文件",
	"practice.folder.check": "勾选 {folder} 里的全部题库",
	"practice.folder.collapse": "折叠 {folder}",
	"practice.folder.expand": "展开 {folder}",
	"practice.totals.files": "{count} 个题库文件",
	"practice.totals.questions": "{count} 道题",
	"practice.totals.answerable": "可作答 {count}",
	"practice.totals.broken": "需修正 {count}",
	"practice.totals.attempts": "已作答 {count} 次",
	"practice.totals.accuracy": "正确率 {rate}",
	"practice.toolbar.selectAll": "全选可作答",
	"practice.toolbar.clear": "清空选择",
	"practice.toolbar.rescan": "重新扫描",
	"practice.toolbar.startSetup": "开始设置（已选 {count} 份）",
	"practice.list.goSetup": "去设置这一轮",
	"practice.empty.none": "没有找到题库文件。",
	"practice.empty.hintFrontmatter": "在笔记的 frontmatter 里写 quiz: true（推荐）。",
	"practice.empty.hintTag": "或者给文件加 #quiz 标签。",
	"practice.empty.hintGlob": "或者在设置里的「题库路径通配符」中加上路径，例如 题库/**。",
	"practice.openSettings": "打开设置",
	"practice.file.parseFailed": "解析失败：{error}",
	"practice.file.issues": "有 {count} 处需要修正，这些题不会进入练习。",
	"practice.file.pick": "设置刷题",
	"practice.file.stats.total": "共 {count} 题",
	"practice.file.stats.answerable": "可作答 {count}",
	"practice.file.stats.broken": "需修正 {count}",
	"practice.file.stats.noRecords": "无记录",
	"practice.file.stats.lastAt": "最近 {date}",
	"practice.file.clearRecords": "清除记录",
	"practice.clear.confirm": "再点一次确认清除",
	"practice.clear.doneFile": "已清除该题库 {count} 道题的记录。",
	"practice.clear.doneQuestion": "已清除这道题的作答记录。",
	"practice.clear.failed": "没有可清除的记录，或笔记写入失败。",
	"practice.picker.heading": "刷题设置",
	"practice.picker.noFiles": "还没有选择题库文件。",
	"practice.picker.back": "返回题库列表",
	"practice.picker.hint": "选择练什么、怎么抽题。开始前会先告诉你这一轮有多少道题。",
	"practice.picker.chip": "{path}（可作答 {count}）",
	"practice.picker.remove": "移除 {path}",
	"practice.picker.modeName": "抽题方式",
	"practice.picker.randomCount": "题数",
	"practice.picker.typeName": "题型",
	"practice.picker.typeDesc": "不勾选任何题型表示不限题型；括号里是当前文件里的可作答题数。",
	"practice.picker.typeLabel": "{label}（{count}）",
	"practice.picker.shuffleName": "打乱顺序",
	"practice.picker.shuffleDesc": "打乱出题顺序与选择题的选项顺序；配对题的每一列始终会打乱。",
	"practice.picker.start": "开始刷题",
	"practice.count.available": "选中文件可作答 {count} 题",
	"practice.count.matching": "符合当前条件 {count} 题",
	"practice.count.planned": "这一轮将刷 {count} 题",
	"practice.notice.empty": "当前条件下没有可刷的题：换一种题型或抽题方式试试。",
	"practice.session.finished": "这一轮已经结束。",
	"practice.session.backToList": "回到题库列表",
	"practice.session.end": "结束本轮",
	"practice.session.index": "第 {index} / {total} 题",
	"practice.session.progress": "对 {correct} · 错 {wrong} · 已答 {answered}",
	"practice.session.missing": "这道题已不存在（文件或题面被改动过）。跳过它，或重新开始一轮。",
	"practice.session.cardFailed": "题卡渲染失败：{error}",
	"practice.session.prev": "上一题",
	"practice.session.next": "下一题",
	"practice.session.results": "查看本轮结果",
	"practice.session.peek": "查看解析",
	"practice.session.jump": "跳到第几题",
	"practice.session.openNote": "打开原题笔记",
	"practice.session.openNoteFailed": "打开原题笔记失败：{error}",
	"practice.session.clearRecords": "清除本题记录",
	"practice.summary.title": "本轮结果",
	"practice.summary.line": "共 {total} 题 · 已作答 {answered} · 正确 {correct} · 错误 {wrong} · 正确率 {rate}%",
	"practice.summary.writeBackOff": "当前设置关闭了记录写回，本轮成绩没有写入笔记。",
	"practice.summary.wrongTitle": "本轮答错的题",
	"practice.summary.wrongItem": "{title}（/{path}）",
	"practice.summary.again": "再刷一轮",
	"practice.summary.retryWrong": "只重做错题",

	// -----------------------------------------------------------------------
	// 解析器提示
	// -----------------------------------------------------------------------
	"parser.frontmatterUnclosed": "frontmatter 未闭合（缺少结束的 ---），已忽略。",
	"parser.frontmatterYamlError": "frontmatter YAML 解析失败：{error}",
	"parser.blockOutsideStem": "第 {line} 行的 `{language}` 数据块不属于任何题面标题，不会被识别。",
	"parser.blockUnclosed": "数据块未闭合（缺少结束的 ```），已按到本题末尾处理。",
	"parser.blockMissing": "缺少 `{language}` 数据块，无法确定题型（type 字段为必填）。",
	"parser.blockYamlError": "数据块 YAML 解析失败：{error}",
	"parser.blockEmpty": "数据块为空，至少需要 `type` 字段。",
	"parser.blockNotMapping": "数据块必须是键值映射（key: value）。",
	"parser.unknownField": "未知字段 `{key}` 已忽略。",
	"parser.shuffleInvalid": "`shuffle` 必须为 true / false，已按 false 处理。",
	"parser.scoreInvalid": "`score` 必须为非负数字，已按 1 处理。",
	"parser.blanksInvalid": "`blanks` 必须是「锚点: 规则」的映射，已忽略。",
	"parser.blankRuleInvalid": "`blanks.{anchor}` 必须是规则对象，已忽略该空位的规则。",
	"parser.questionInvalid": "`question` 必须是非空字符串，已改用标题作为题面标题。",
	"parser.distractorsInvalid": "`distractors` 必须是数量或 `{ count, pool }`，已忽略。",
	"parser.distractorsUnsupported": "`distractors` 只对单选题和多选题有效，已忽略。",
	"parser.typeMissing": "缺少 `type` 字段，无法确定题型。合法取值：{types}。",
	"parser.typeInvalid": "`type: {value}` 非法。合法取值：{types}。",
	"parser.columnUnnamed": "第 {index} 列",
	"parser.columnGrouped": "{base}（第 {count} 组）",
	"parser.anchorDuplicate": "锚点 `^{anchor}` 重复，判分会不稳定。",
	"parser.answerIgnoredMatch": "配对题的答案由表格行顺序决定，`answer` 字段已忽略。",
	"parser.answerIgnoredEssay": "问答题没有固定答案，`answer` 字段已忽略。",
	"parser.answerIgnoredBlank": "填空题的答案取自题面 `==…==`，`answer` 字段已忽略。",
	"parser.answerMissing": "缺少 `answer` 字段，该题无法判分。",
	"parser.answerSingleInvalid": "单选题的 `answer` 必须是单个锚点字符串（如 `c`）。",
	"parser.answerMultiInvalid": "多选题的 `answer` 必须是锚点数组（如 `[a, b]`）。",
	"parser.listTooFew": "`type: {type}` 要求题面至少包含 2 个无序列表选项，当前识别到 {count} 个。",
	"parser.answerNoOption": "`answer: {answer}` 没有对应的选项锚点。",
	"parser.answerAnchorsMissing": "`answer` 中的锚点 {anchors} 没有对应选项。",
	"parser.matchNoTable": "`type: match` 要求题面包含表格（表头 + 至少 1 行数据）。",
	"parser.matchTooFewColumns": "配对表格至少需要 2 列，当前为 {count} 列。",
	"parser.matchNoPairs": "配对表格里没有可连线的相邻列条目。",
	"parser.blankNoMarker": "`type: blank` 要求题面包含 `==答案== ^锚点` 形式的空位。",
	"parser.blankAnchorsDuplicate": "空位锚点 {anchors} 重复。",

	// -----------------------------------------------------------------------
	// 判分说明
	// -----------------------------------------------------------------------
	"grade.notAnswerable": "题目「{title}」当前不可作答：{reasons}",
	"grade.unknownType": "未知题型，无法判分。",
	"grade.choice.missing": "漏选：{anchors}",
	"grade.choice.extra": "多选：{anchors}",
	"grade.anchorLabel": "{anchor}（{text}）",
	"grade.blank.expected": "第 {index} 空应为「{expected}」",
	"grade.match.missing": "缺少连线：「{left}」—「{right}」",
	"grade.match.extra": "多余的连线：「{left}」—「{right}」",
	"grade.essay.wrong": "已标记为未掌握",

	// -----------------------------------------------------------------------
	// 写回
	// -----------------------------------------------------------------------
	"writeback.invalidYaml": "补丁后的数据块不是合法的 YAML 映射，已放弃写入以保护笔记。",
};
