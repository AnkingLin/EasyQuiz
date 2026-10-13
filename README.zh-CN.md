# EasyQuiz

[![Node.js build](https://github.com/AnkingLin/EasyQuiz/actions/workflows/lint.yml/badge.svg)](https://github.com/AnkingLin/EasyQuiz/actions/workflows/lint.yml)

[English](README.md) · **中文**

一个以 Markdown 为原生格式的 Obsidian 刷题插件。题目用**普通 Markdown** 书写，渲染成可交互的题卡界面，作答记录会**写回笔记本身**。

- 题库：任何标有 `quiz: true`（或带 `#quiz` 标签）的 Markdown 文件。
- 题干：一个标题。
- 选项 / 配对项 / 空位：原生列表、表格与 `==highlights==`。
- 知识点：题面标题末尾的 `^[[[]]]`——`^[`、一个 Obsidian 双向链接、`]`，`[]` 处填链接目标——把题目关联回它来源的笔记。
- 机器数据：每道题下方的一个 `quiz` 数据块。
- 记录：`stats`（汇总）与有上限的 `history`，都存在笔记本身里。
- 界面：英文与中文，跟随 Obsidian 的语言（见[界面语言](#界面语言)）。

## 快速开始

1. 安装插件（见[安装到 vault](#安装到-vault)）并启用它。
2. 新建一篇笔记，用 frontmatter 给它勾上 **quiz**，然后写一道题：

   ````markdown
   ---
   quiz: true
   ---

   ## TCP 建立连接需要几次握手？ ^[[[计算机网络/传输层#TCP 三次握手]]]

   - 一次 ^a
   - 两次 ^b
   - 三次 ^c
   - 四次 ^d

   ```quiz
   id: tcp-handshake
   type: single
   answer: c
   ```
   ````

3. 切换到阅读视图：`quiz` 数据块会变成一张题卡。作答并提交，记录会写回笔记。
4. 在命令面板里运行**打开刷题窗口**（或点击丝带图标），即可刷完整个题库，也可以一次刷多个题库。

本文档其余部分是格式参考。

## 把题目关联到知识点

每个题面标题都应以 `^[[[]]]` 结尾——`^[`、一个 Obsidian 双向链接、`]`：这个链接把题目关联回它来源的笔记。中间的 `[[]]` 就是双向链接本身，`[]` 处填链接目标，所以填好之后标题长这样：

```markdown
## TCP 建立连接需要几次握手？ ^[[[计算机网络/传输层#TCP 三次握手]]]
```

- `^[ … ]` 这层包装把链接标成题干的注记，而不是普通题目文字；里面的 `[[…]]` 是真正的 Obsidian 双链：会渲染成链接，题库笔记也会出现在目标笔记的反向链接面板里。
- 解析器会**把它从显示的标题和推导出的 id 中剥离**，因此重新指向链接永远不会让已累积的 `stats` / `history` 失联。链接目标可通过 `QuizQuestion.knowledgeLink` 取得，题卡会在头部下方把它显示为一行**可点击的知识点**。
- `rev`（题干哈希）由题干正文计算，而不是标题，因此**重新链接一道题不会把它的记录标记为「题面已变更」**。
- 只有位于末尾的 `^[[[]]]` 才算数。旧的两对方括号写法 `^[[…]]` 仍然被识别，因此按老写法记的笔记不会失效。想在题目文字里放行内链接时，就在题干正文里写普通的 `[[]]`；只有标题上的链接会被剥离。
- 对解析器来说链接是可选的——没有链接的题目只是 `knowledgeLink: null`。

完整的出题规范（包括五种题型与检查清单）见 [`skills/easyquiz-authoring/SKILL.md`](skills/easyquiz-authoring/SKILL.md)。它是写给编写或审阅题库的 AI agent 看的，其中的示例会被测试套件执行，所以文档里给出的骨架保证能解析通过。

## 开发

```bash
npm install
npm run dev        # watch src/main.ts, rebuild main.js on change
npm run build      # tsc type check + production bundle
npm test           # bundle and run the test suite (304 cases)
npm run typecheck  # type check only
npm run lint       # eslint (eslint-plugin-obsidianmd)
```

测试套件分两层：

- **纯逻辑**（`parser`、`stem`、`grade`、`writeback`、`match-board`、`insert`、`session`）：纯 node，无 DOM。
- **DOM**（`tests/quiz-match-dom.test.ts`、`tests/quiz-insert-modal.test.ts`、`tests/quiz-practice-view.test.ts`、`tests/quiz-knowledge-link.test.ts`、`tests/quiz-i18n.test.ts`）：
  在 jsdom 下通过 `renderQuizCard` 渲染真实的题卡与连线板并点击其节点，因此点击处理、连线目标、各列之间的隔离、`MarkdownRenderer` 契约以及知识点链接都是被验证过的，而不是假设的；插入对话框通过
  `InsertQuestionModal` 打开并驱动其控件；刷题窗口通过
  `PracticeView` 打开并走完它的全部三个页面。`tests/dom.ts` 安装 Obsidian 风格的 DOM 辅助函数
  （`createDiv`、`addClass`、…），`tests/obsidian-stub.ts` 则代替只有类型定义的 `obsidian` 包。

`tests/quiz-skill-doc.test.ts` 把文档和代码闭环起来：它读取 `skills/easyquiz-authoring/SKILL.md`，抽出每个被标记的示例，交给真正的解析器与判分器。文档里的骨架如果无法作答，测试套件就会失败。

`tests/quiz-i18n.test.ts` 覆盖另一个方向：两张文案表必须暴露相同的键和相同的 `{placeholders}`，而且英文界面是真正渲染出来的（题卡、解析器提示、刷题窗口），而不只是查表。套件的其余部分用中文文案表运行，中文是插件最初的界面语言，也是它的测试夹具使用的语言。

源码结构：

```
src/main.ts          plugin entry: code-block processor, commands, view registration, settings tab
src/parser.ts        question-bank parser (pure logic, no obsidian import)
src/types.ts         question model and parse-result types
src/stem.ts          stem preprocessing: strips what the interactive controls render (pure logic)
src/grade.ts         grading for the five question types (pure logic)
src/writeback.ts     record write-back: only stats/history/rev, validated before writing
src/hash.ts          stem hash (rev change detection)
src/match-board.ts   matching board state machine: adjacent-column links (pure logic)
src/session.ts       practice planning: file summaries, filtering, sampling, progress (pure logic)
src/runtime.ts       Obsidian adapter: file detection, dependency injection, atomic writes
src/view.ts          practice card rendering (including the header's knowledge-point link)
src/practice-view.ts practice window: question-bank list / practice settings / practice
src/insert.ts        question templates and insertion positioning (pure logic)
src/insert-modal.ts  insert-question dialog and the editor write
src/labels.ts        question-type labels and default stem titles, shared by card/dialog/window (pure logic)
src/i18n/            English/Chinese message tables and the language state (pure logic)
skills/              agent-facing authoring spec (SKILL.md), examples verified by the test suite
tests/               parser / stem / grading / write-back / insert / session tests, the window tests, a fixture
```

`parser` / `stem` / `grade` / `writeback` / `hash` / `insert` / `session` / `labels` / `i18n` 刻意**不**导入 `obsidian`，因此它们可以在纯 Node 下运行；所有对 Obsidian API 的依赖都限制在 `runtime.ts`、`view.ts`、`practice-view.ts` 和 `insert-modal.ts` 里。文案表也是如此：它们是普通对象，所以解析器不必接触 Obsidian API 就能产生本地化的提示。

题干渲染时会**去掉**那些有自己交互控件的部分——选项列表、配对表格以及 `==answer==` 文本都会被剥离，以免同一内容显示两遍。

## 安装到 vault

1. 新建 `<Vault>/.obsidian/plugins/easy-quiz/`。
2. 把 `main.js`、`manifest.json` 和 `styles.css` 复制进去。
3. 重新加载 Obsidian，在**设置 → 第三方插件**下启用该插件。

## 题目格式

### 题库文件

````markdown
---
quiz: true
schemaVersion: 1
title: 计算机网络 · 第三章
tags:
  - quiz/net
---

# 计算机网络 · 第三章
````

只要满足以下任一条，文件就会被当作题库：

1. frontmatter 里的 `quiz: true`（**推荐**——可以保持正文干净）；
2. 文件级的 `#quiz` 标签（frontmatter 标签或行内标签）；
3. 配置的路径通配符命中（例如 `题库/**`）。

### 一道题的构成

- 一道题的范围从它的题面标题开始，到**下一个同级或更高级别的标题**为止。
- 标题文字就是题目标题；在末尾写 `^[[[]]]` 可以记录来源知识点（见[把题目关联到知识点](#把题目关联到知识点)）。
- `quiz` 数据块是**必填**的：题型来自它的 `type` 字段。
- 如果数据块缺失、`type` 缺失或非法，或者 YAML 解析失败，这一道题会**降级为普通代码块**并附带高亮的说明。其他题目不受影响。
- 把数据块放在题目末尾（或者紧跟在标题之后——两者等价）。

**题面标题层级。** 只有当文件后面**出现更浅的标题**时，更深的标题才会被当作当前题目的子标题；否则它自己就是一道题的题干。实践中：每个文件只用一种标题层级（默认 H2）。如果某个题干后面还跟着另一个 H2，而中间用 H3 分小节，那么这些 H3 会被正确地归入该题。

### 元数据字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | **是** | `single` / `multi` / `match` / `blank` / `essay`。决定题型的*唯一*依据。 |
| `id` | 否 | 稳定标识符；省略时由标题文字推导（不含 `^[[[]]]` 知识点链接）。 |
| `answer` | 视题型而定 | `single`：`c`；`multi`：`[a, b]`；`blank` 与 `match` 与 `essay`：不使用。 |
| `blanks` | 否 | 每个空位的匹配规则：`strict` / `ignoreCase` / `regex` / `accept`。键是空位锚点。 |
| `shuffle` | 否 | 打乱顺序。默认 `false`；`match` 始终打乱。 |
| `explanation` | 否 | 解析文字。也可以写成行内的 `> [!note]- 解析` 标注。 |
| `score` | 否 | 分值，默认 1。 |
| `stats` | 否 | **由插件写入**：`attempts` / `correct` / `lastResult` / `lastAt`。 |
| `rev` | 否 | **由插件写入**：题干哈希，用于检测改动。 |

`stats` 和 `rev` 由插件自动维护——**作者从不写它们**。

### 锚点

选择题选项和空位使用 Obsidian 原生的块 ID 语法 `^id`，因此答案绑定的是锚点而不是位置：插入、删除或重排选项永远不会让记录错位。

````markdown
- A option ^a
- B option ^b

The minimum TCP header length is ==20== ^b1 bytes.
````

配对表格**不**使用锚点：表格单元格里的 `^id` 会被当作普通文字，行级锚点也不支持。配对题的记录以行内容哈希加行号作为键，所以修改表格只会把受影响的记录标记为「题面已变更」，而不会悄悄丢弃它们。

### 单选

````markdown
## TCP 建立连接需要几次握手？ ^[[[计算机网络/传输层#TCP 三次握手]]]

- 一次 ^a
- 两次 ^b
- 三次 ^c
- 四次 ^d

```quiz
id: tcp-handshake
type: single
answer: c
explanation: 三次握手用于同步双方的初始序列号。
```
````

### 多选

````markdown
## 下列哪些属于传输层协议？ ^[[[计算机网络/传输层#传输层协议]]]

- TCP ^a
- UDP ^b
- IP ^c
- ICMP ^d

```quiz
type: multi
answer: [a, b]
shuffle: true
```
````

### 配对

写成一张**多列表格**。表格最初的行顺序*就是*正确答案；刷题时顺序会被打乱。

````markdown
## 将协议与其默认端口配对 ^[[[计算机网络/应用层#常见默认端口]]]

| 协议 | 端口 |
| --- | --- |
| HTTP | 80 |
| HTTPS | 443 |
| SSH | 22 |

```quiz
type: match
```
````

- 只有 `type: match` 时表格才会被当作配对题；其他题型里的表格只是普通正文，不参与判分。
- **只允许相邻列之间连线。** 一行 `A | B | C` 表示 `A–B` 和 `B–C` 两条连线；第一列与最后一列之间刻意不建立连线。先点第 1 列的条目再点第 3 列的条目会被拒绝。
- **方向无关**：先左后右和先右后左点击产生同一条连线，判分也完全一样。
- **每个条目在一对相邻列之间最多只能连一条线。** 再把它连到同一列中的另一个条目会替换掉原来的线。
- 同一列里的多个条目可以指向相邻列的同一个条目（合并选项），例如 `MySQL` 和 `PostgreSQL` 都连到 `关系型`。
- 点击一个已连线的条目只是选中它，不会悄悄去掉它的连线。
- **替换时旧线会保留到新线建立为止**：先建立新连线，再释放旧连线，因此连线板不会经过一个什么都没连的中间状态。
- **顺序会打乱**：每一列都独立打乱，所以表格的行顺序永远不会泄露答案。
- **重复条目会合并**：同一列里文字相同的条目只出现一次。
- 增加或重排表格行不会让记录失效——条目的键只取决于列号和文字。
- 表格本身不会被渲染——它由连线板替代，所以同一内容不会出现两遍。
- 表头重复或为空的列会得到可区分的名字（例如 `层级（第 2 组）`）。
- **多列**会沿表格依次串联，所有相邻列对都必须配对：

  ````markdown
  | 协议 | 端口 | 层级 |
  | --- | --- | --- |
  | HTTP | 80 | 应用层 |
  | IP | 0 | 网络层 |
  ````

- **一对多**：在一个单元格里用 ` / ` 分隔多个条目。两侧都会拆分，且条目仍按它们来自的行分组：

  ````markdown
  | 数据库 | 类型 |
  | --- | --- |
  | MySQL / PostgreSQL | 关系型 |
  | Redis / Memcached | 键值型 |
  ````

  这样第一列会得到 `MySQL`、`PostgreSQL`、`Redis`、`Memcached` 四个条目——每个都连到自己所在行的类型，所以 `MySQL` 和 `PostgreSQL` 都连到 `关系型`。
- 表格至少需要 2 列，否则该题会降级并给出提示。

### 填空

标记是可配置的（见设置中的**填空标记**）：`==answer==`（默认）、`**answer**`，或两者都识别。空位锚点 `^bN` 是**可选的**——不写它，空位会按出现顺序自动编号。

````markdown
## 补全 TCP 首部字段 ^[[[计算机网络/传输层#TCP 首部]]]

TCP 首部的最小长度是 ==20== 字节，其中 ==序号== 字段用于标识本报文段的数据的第一个字节。

```quiz
type: blank
blanks:
  b1: { accept: ["20", "20字节", "二十"] }
  b2: { ignoreCase: true }
```
````

- 每个被标记的片段就是一个空位；空位数量由题目正文决定。
- 只有在需要从 `blanks` 引用某个空位时才写显式锚点：

  ````markdown
  最小长度是 ==20== ^len 字节。
  ````

- 没写出的锚点会按位置编号为 `b1`、`b2`、…；同一道题里混用显式锚点和自动编号是可以的。
- 代码块和行内代码里的标记会被忽略，所以你可以在正文里写 `==like this==` 作为示例。
- 没有列在 `blanks` 下的空位使用严格匹配（忽略两侧空白）。
- 在界面上，空位是**内嵌在题干里**渲染的下划线缺口，会随输入内容变宽：点击缺口即可输入。提交前答案文字绝不会出现在题干里。

### 问答

没有固定答案。正文形式自由，参考答案用**折叠标注**书写，以免剧透题目。

````markdown
## 简述 TCP 与 UDP 的主要区别。 ^[[[计算机网络/传输层#TCP 与 UDP 对比]]]

从连接、可靠性、传输方式与适用场景四个方面作答。

> [!question]- 参考答案
> TCP 面向连接、可靠、字节流；UDP 无连接、不保证可靠、报文边界保留。

```quiz
type: essay
```
````

判分方式是**自评**：作答后标记为已掌握或未掌握。

### `type` 缺失或非法时

题型**绝不会根据内容形态推断**。每个问题只降级它自己那道题，也绝不猜测答案：

| 情况 | 行为 |
|---|---|
| `type` 缺失 | 降级；提示 `type` 为必填 |
| `type` 取值非法 | 降级；列出五个合法取值 |
| `type: single`/`multi` 但没有列表 | 结构不符；不可作答 |
| `type: match` 但没有表格，或列数少于 2 | 结构不符 |
| `type: blank` 但没有 `==…==` | 结构不符 |
| 选项缺少锚点，或锚点重复 | 不可作答 |
| `answer` 指向不存在的锚点 | 不可作答 |
| YAML 解析错误 | 降级；显示原始错误 |

## 命令

| 命令 | 作用 |
|---|---|
| 打开刷题窗口 | 打开刷题窗口（丝带图标同样可以）：题库列表 → 刷题设置 → 刷题 |
| 插入题目 | 打开对话框生成题目骨架（题型 + 题干标题）并插入到光标处 |
| 校验当前题库文件 | 解析当前笔记并报告有多少题可作答、多少题需要修正 |
| 刷新题库视图 | 强制阅读视图重新渲染 `quiz` 数据块（编辑后也会自动触发） |

插入对话框也可以从编辑器右键菜单打开（**右键 → 插入题目**，仅限 Markdown 笔记）。它只询问题型和题干标题；字段名与语法来自模板，写入前会先预览 Markdown：

````markdown
## 单选题干

- 选项内容 ^a
- 选项内容 ^b

```quiz
type: single
answer: a
```
````

占位文字跟随**界面语言**，所以英文界面插入英文骨架，中文界面插入中文骨架；结构才是关键。骨架从一开始就是一道可作答的题——替换占位文字后在阅读视图里提交即可。标题层级、数据块语言和填空标记都跟随下面的设置，插入位置也会被规范化，使这道题与相邻内容之间始终恰好隔一个空行（无论光标在哪里、原来有几个空行、插入过多少次）。

## 刷题窗口

一个包含三个页面的侧边栏视图，整轮刷题都不用离开它（**打开刷题窗口**，或丝带图标）：

1. **题库列表**——vault 里的每个题库文件，按文件夹分组、按路径列出，并在同一行给出它的数据：题目总数、可作答数、需修正数、各题型数量、作答次数与正确率，以及最近一次作答的日期。解析失败的文件会报告自己的错误，不会破坏整个列表。勾选一个或多个文件（或点**全选可作答**）即可把它们放在一起刷；页头会汇总所选内容。
2. **刷题设置**——这一轮怎么抽题：
   - **顺序刷题**：按文件顺序取全部候选题。
   - **定量随机抽题**：打乱后取 N 道（填 0 或留空表示全部）。
   - **只刷错题**：只保留上次作答错误的题。
   - **题型**：单选 / 多选 / 配对 / 填空 / 问答的任意子集；一个都不勾表示不限题型。不可作答（降级）的题永远不会进入任何一轮。
   - **打乱顺序**：打乱出题顺序与选择题的选项顺序（配对题的每一列始终会打乱）。
   开始按钮上方的计数行会先告诉你有多少道候选题、这一轮实际会刷多少道。
3. **刷题**——一次一道题，用与笔记里相同的题卡界面渲染，带进度条、对错计数、上一题/下一题（轮次较长时还有跳转框）。提交通过同一个 `QuizService` 判分，因此记录会和阅读视图里一样写回笔记。提交后会在原处显示正确答案——正确选项加边框、填空答案写进缺口、配对题画出正确的连线——随后是解析。**查看解析**会在不判分的情况下揭示答案。最后一页汇总本轮结果，列出答错的题，并提供**只重做错题**。

作答以文件路径 + 题目 id 作为键，因此即使文件被编辑，一轮刷题也不会错乱：题库文件变化时窗口会重新解析，每次写回之后也会再解析一次。

## 设置

| 设置 | 默认值 | 说明 |
|---|---|---|
| 界面语言 | 跟随 Obsidian | `跟随 Obsidian`、`English` 或 `中文`——见[界面语言](#界面语言) |
| 数据块语言 | `quiz` | 如果与别的插件冲突就改掉；改后需要重新加载 Obsidian |
| 填空标记 | `==` | 用哪种 Markdown 标记表示空位：`==answer==`、`**answer**`，或两者都识别 |
| 题面标题层级 | H2 | 决定哪些标题被当作一道题 |
| 题库路径通配符 | 空 | 每行一条，例如 `题库/**` |
| 记录写回 | 开 | 关闭后只在界面上判分，不修改笔记 |
| 单题历史条数上限 | 10 | 记录写在笔记内，所以明细列表必须有上限；`0` 表示只保留汇总 |

## 界面语言

界面提供**英文和中文**两种。不需要安装额外的翻译文件：两张文案表都打包在插件里，插件加载时二选一——修改设置的那一刻也会重新选择。

- **跟随 Obsidian**（默认）会读取 Obsidian 自己的语言，是中文变体（`zh`、`zh-CN`、`zh-TW`、…）时使用中文，其他情况使用英文。
- **界面语言**设置可以覆盖这个选择。
- 切换语言会立即重渲染刷题窗口、设置页，以及阅读视图里已经打开的题卡，此后插入的模板也使用新语言。命令面板里的命令名和丝带图标的悬停提示是在插件加载时注册的，所以要**重新加载**后才会变化。
- 题目**内容**永远不会被翻译：用中文写的题就保持中文，`explanation`、选项文字以及笔记里的其他一切也都一样。只有界面文字——按钮、通知、解析器提示、判分说明，以及新插入骨架的占位文字——跟随语言设置。

## 记录如何存储

一切都写进题目自己的 `quiz` 数据块里，因此记录会跟着笔记一起走。

```yaml
type: single
answer: c
stats: { attempts: 12, correct: 9, lastResult: correct, lastAt: 2025-01-01T10:00:00Z }
rev: 8f3c1a
history:
  - { at: 2025-01-01T10:00:00Z, result: correct, ms: 4200 }
  - { at: 2025-01-01T09:58:11Z, result: wrong, answer: ["b"], ms: 6100 }
```

- `stats` 是永不截断的汇总，正确率之类的数字由它得出。
- `history` 受上面设置的上限约束；超出时先丢弃最早的条目。

写回规则：

1. 只改动 `stats`、`history` 和 `rev`——其他内容逐字节保留。
2. 写入通过 `Vault.process`（原子的读—改—写）完成；数据块会从最新的文件内容里重新定位，因此这期间的编辑不会被覆盖。
3. 打好补丁的数据块会先重新按 YAML 校验；校验失败就跳过这次写入，而不是冒着写坏笔记的风险。

### 已知限制

| 限制 | 影响 | 应对 |
|---|---|---|
| 每次作答都会重写笔记 | 用 Git 的用户会看到 `git status` 频繁变动；Sync 可能产生冲突 | 可以在设置里关闭写回 |
| 明细列表必须有上限 | 不会保留完整的作答历史 | `stats` 从不截断；调高上限即可 |
| 笔记位于不可写的 vault 中 | 记录无法持久化 | 作答仍然在界面上判分 |

## 状态

已实现并有测试覆盖：解析器、题干预处理、五种题型的判分、记录写回、连线板逻辑、题目模板及其插入定位、题卡界面（选项、可点击连线的多列配对及打乱、内嵌的点击输入式空位及其随内容变宽、问答题自评，以及可点击的知识点链接）、刷题窗口（带逐文件数据的题库列表、带题型/抽题筛选的刷题设置，以及一次一道题、在原处揭示答案并给出最终报告的一轮），还有带语言设置的英文/中文界面。题库文件被修改会触发防抖的阅读视图刷新，并使窗口缓存的解析结果失效。

尚未实现：把多次写回合并成一次文件写入，以及跨轮次的统计（错题本、图表）——目前只有窗口为单轮计算出的那些数据。

> 题卡界面、插入对话框、写回和刷题窗口都**尚未**在真实的 Obsidian 实例里验证过。逻辑层（解析、题干预处理、判分、写回、模板生成、插入定位和轮次规划）有完整测试，窗口的三个页面也在 jsdom 下跑过，但 DOM 行为——列与列之间的连线渲染、填空输入框的焦点处理、阅读模式的重渲染、对话框在真实弹窗里的渲染方式，以及侧边栏视图在真实工作区中的布局——只能在 Obsidian 里手工确认。

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| `quiz` 数据块显示为普通代码块 | 笔记没有被识别为题库，或者数据块不在任何题面标题之下 | 加上 `quiz: true`，并检查标题层级与**题面标题层级**设置一致 |
| 题卡出现了，但点**提交答案**没有反应 | 该题已降级（数据块上方会显示提示） | 按提示指出的问题修正——通常是 `type`、缺失的锚点或 YAML 错误 |
| 编辑题目后屏幕上还留着旧题卡 | 阅读视图不会自己重渲染代码块 | 插件会自动刷新；否则运行**刷新题库视图** |
| 重命名之后记录不再累积 | `id` 是由旧的标题文字推导出来的 | 给这道题写一个显式的 `id`；**记录以文件路径 + 题目 id 为键** |
| 某个 `quiz` 数据块被完全忽略 | 它不在任何被当作题目的标题之下 | 把它移到某个题面标题之下 |
| 改了数据块语言后没生效 | 处理器是在插件加载时注册的 | 重新加载 Obsidian |
| 另一个插件的 `quiz` 片段不再渲染 | 本插件占用了 `quiz` 数据块语言 | 在设置里改掉**数据块语言**，然后重新加载 |

支持的语言：**English**（[README.md](README.md)）和 **中文**（本文件）。

## 参与贡献

- `main.ts` 只保留插件生命周期；功能逻辑放在 `src/` 下各自独立的模块里。
- `parser` / `stem` / `grade` / `writeback` / `hash` / `insert` / `session` 不得导入 `obsidian`，这样它们才能在纯 Node 下保持可测试。
- 绝不要硬编码界面文案：在 `src/i18n/en.ts` 里加键，在 `src/i18n/zh.ts` 里填写（两张表会互相做类型检查），然后通过 `t()` 读取。两张表里的 `{placeholders}` 要保持一致。
- 改变用户可见的行为时，要同时更新 `README.md`、`README.zh-CN.md` **和** `skills/easyquiz-authoring/SKILL.md`——后者的示例会被 `npm test` 执行。
- 提交 PR 之前先运行 `npm run build`、`npm test` 和 `npm run lint`；CI 会跑这三项。

## 许可证

0-BSD，见 [LICENSE](LICENSE)。
