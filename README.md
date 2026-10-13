# EasyQuiz

[![Node.js build](https://github.com/AnkingLin/EasyQuiz/actions/workflows/lint.yml/badge.svg)](https://github.com/AnkingLin/EasyQuiz/actions/workflows/lint.yml)

**English** · [中文](README.zh-CN.md)

An Obsidian plugin for Markdown-native quiz practice. Questions are written as **plain Markdown**, rendered as an interactive card UI, and attempt records are written back **into the note**.

- Question bank: any Markdown file marked with `quiz: true` (or a `#quiz` tag).
- Question stem: a heading.
- Options / pairs / blanks: native lists, tables, and `==highlights==`.
- Knowledge point: a `^[[[]]]` at the end of the stem heading — `^[`, an Obsidian wikilink, `]`, with `[]` marking the target slot — tying the question back to the note it came from.
- Machine data: a small `quiz` block under each question.
- Records: `stats` (summary) and a capped `history`, stored in the note itself.
- Interface: English and Chinese, following Obsidian's language (see [Interface language](#interface-language)).

## Quick start

1. Install the plugin (see [Installing into a vault](#installing-into-a-vault)) and enable it.
2. Create a note, tick **quiz** on it with frontmatter, and write one question:

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

3. Switch to reading view: the `quiz` block becomes a card. Answer it and submit — the record is written
   back into the note.
4. Run **Open practice window** in the command palette (or click the ribbon icon) to practise a whole
   question bank, or several at once.

The rest of this document is the reference for the format.

## Linking questions to their knowledge points

Every stem heading should end with `^[[[]]]` — `^[`, then an Obsidian wikilink, then `]`: the link that
ties the question back to the note it was derived from. The `[[]]` in the middle is the wikilink and `[]` is
where the target goes, so a finished heading looks like this:

```markdown
## TCP 建立连接需要几次握手？ ^[[[计算机网络/传输层#TCP 三次握手]]]
```

- The `^[ … ]` wrapper marks the link as an annotation of the stem rather than ordinary question text. The
  `[[…]]` inside it is a real Obsidian wikilink: it renders as a link, and the question-bank note appears in
  the target's backlinks panel.
- The parser **strips it from the displayed title and from the derived id**, so retargeting a link never
  disconnects accumulated `stats` / `history`. The link target is available as
  `QuizQuestion.knowledgeLink`, and the card shows it as a **clickable Knowledge point row** under the header.
- `rev` (the stem hash) is computed from the stem body, not the heading, so **relinking a question does
  not mark its records as "stem changed"**.
- Only a trailing `^[[[]]]` counts. The older two-bracket form `^[[…]]` is still recognised, so notes
  written before this convention keep working. Write a plain `[[]]` inside the stem body when you want an
  inline link in the question text; only the heading link is stripped.
- Links are optional as far as the parser is concerned — a question without one simply has
  `knowledgeLink: null`.

The full authoring convention, including the five question types and the review checklist, lives in
[`skills/easyquiz-authoring/SKILL.md`](skills/easyquiz-authoring/SKILL.md). It is written for AI agents
authoring or reviewing a bank, and its examples are executed by the test suite, so the documented
skeletons are guaranteed to parse.

## Development

```bash
npm install
npm run dev        # watch src/main.ts, rebuild main.js on change
npm run build      # tsc type check + production bundle
npm test           # bundle and run the test suite (304 cases)
npm run typecheck  # type check only
npm run lint       # eslint (eslint-plugin-obsidianmd)
```

The suite has two layers:

- **Pure logic** (`parser`, `stem`, `grade`, `writeback`, `match-board`, `insert`, `session`): plain node, no DOM.
- **DOM** (`tests/quiz-match-dom.test.ts`, `tests/quiz-insert-modal.test.ts`, `tests/quiz-practice-view.test.ts`,
  `tests/quiz-knowledge-link.test.ts`, `tests/quiz-i18n.test.ts`):
  renders the real card and board through `renderQuizCard` under jsdom and clicks its nodes, so click handling,
  line targets, per-column isolation, the `MarkdownRenderer` contract and the knowledge-point link are checked
  rather than assumed; the insert
  dialog is opened through `InsertQuestionModal` and its controls are driven; the practice window is opened through
  `PracticeView` and walked through all three of its pages. `tests/dom.ts` installs the Obsidian-style DOM helpers
  (`createDiv`, `addClass`, …) and `tests/obsidian-stub.ts` stands in for the type-only `obsidian` package.

`tests/quiz-skill-doc.test.ts` closes the loop between documentation and code: it reads
`skills/easyquiz-authoring/SKILL.md`, extracts every marked example, and feeds it to the real parser and
grader. A documented skeleton that cannot be answered fails the suite.

`tests/quiz-i18n.test.ts` covers the other direction: the two message tables must expose the same keys and
the same `{placeholders}`, and the English interface is rendered for real (card, parser warning, practice
window) rather than only looked up. The rest of the suite runs with the Chinese table, which is the
plugin's original interface and the language of its fixtures.

Source layout:

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

`parser` / `stem` / `grade` / `writeback` / `hash` / `insert` / `session` / `labels` / `i18n` deliberately
do **not** import `obsidian`, so they run under plain Node; every Obsidian API dependency is confined to
`runtime.ts`, `view.ts`, `practice-view.ts`, and `insert-modal.ts`. That includes the message tables: they
are plain objects, so the parser can produce a localized warning without touching the Obsidian API.

The stem is rendered **without** the parts that get their own interactive control — the option list,
the matching table, and the `==answer==` text are stripped so that nothing is displayed twice.

## Installing into a vault

1. Create `<Vault>/.obsidian/plugins/easy-quiz/`.
2. Copy `main.js`, `manifest.json`, and `styles.css` into it.
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

## Question format

### Question bank file

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

A file is treated as a question bank when any of these hold:

1. frontmatter `quiz: true` (**preferred** — keeps the body clean);
2. a file-level `#quiz` tag (frontmatter tags or an inline tag);
3. a configured path glob matches (e.g. `题库/**`).

### Anatomy of a question

- A question spans from its stem heading to the **next heading of the same or higher level**.
- The heading text is the question title; end it with `^[[[]]]` to record the source knowledge point
  (see [Linking questions to their knowledge points](#linking-questions-to-their-knowledge-points)).
- The `quiz` block is **required**: the question type comes from its `type` field.
- If the block is missing, `type` is missing or invalid, or the YAML fails to parse, that one question
  **degrades to a normal code block** with a highlighted explanation. Other questions are unaffected.
- Put the data block at the end of the question (or right after the heading — both are equivalent).

**Stem heading levels.** A deeper heading is treated as a sub-heading of the current question
**only if a shallower heading appears later** in the file; otherwise it is itself a question stem.
In practice: use a single heading level per file (default H2). If you use H3 for sub-sections of a
stem that is followed by another H2, the H3 is correctly absorbed into that question.

### Metadata fields

| Field | Required | Notes |
|---|---|---|
| `type` | **yes** | `single` / `multi` / `match` / `blank` / `essay`. The *only* thing that decides the type. |
| `id` | no | Stable identifier; derived from the heading text (with the `^[[[]]]` knowledge link excluded) when omitted. |
| `answer` | type-dependent | `single`: `c`; `multi`: `[a, b]`; `blank` and `match` and `essay`: not used. |
| `blanks` | no | Per-blank matching rules: `strict` / `ignoreCase` / `regex` / `accept`. Keys are blank anchors. |
| `shuffle` | no | Shuffle order. Default `false`; `match` is always shuffled. |
| `explanation` | no | Explanation text. May also be written inline as a `> [!note]- 解析` callout. |
| `score` | no | Points, default 1. |
| `stats` | no | **Written by the plugin**: `attempts` / `correct` / `lastResult` / `lastAt`. |
| `rev` | no | **Written by the plugin**: stem hash, used to detect edits. |

`stats` and `rev` are maintained automatically — **authors never write them**.

### Anchors

Choice options and blanks use Obsidian's native block-ID syntax `^id`, so answers are tied to
anchors rather than positions: inserting, deleting, or reordering options never misaligns records.

````markdown
- A option ^a
- B option ^b

The minimum TCP header length is ==20== ^b1 bytes.
````

Matching tables do **not** use anchors: a `^id` in a table cell is treated as literal text, and
row-level anchors are unsupported. Match records are keyed by row-content hash plus row index, so
editing a table marks the affected records as "stem changed" rather than silently discarding them.

### Single choice

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

### Multiple choice

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

### Matching

Written as a **multi-column table**. The table's original row order *is* the correct answer; the
order is shuffled during practice.

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

- A table is only read as a matching question when `type: match`; tables in other question types are
  ordinary prose and are not graded.
- **Connections are only allowed between adjacent columns.** A row `A | B | C` means the two links
  `A–B` and `B–C`; there is deliberately no link between the first and last column. Clicking an item
  in column 1 and then column 3 is rejected.
- **Direction does not matter**: clicking left-then-right and right-then-left produce the same link,
  and both score identically.
- **Each item links at most once per neighbouring column pair.** Connecting it again to another item
  in that same column replaces the old line.
- Several items in one column may point at the same item in the neighbouring column (merged options),
  e.g. `MySQL` and `PostgreSQL` both linking to `关系型`.
- Clicking a connected item only selects it; it does not silently drop its line.
- **Replacing keeps the line until the new one exists**: the new line is created first and the old one
  released afterwards, so the board never passes through a state where nothing is connected.
- **Order is shuffled**: every column is shuffled independently, so the table's row order never gives
  the answer away.
- **Duplicate entries are merged**: within one column, items with the same text appear once.
- Adding or reordering table rows does not invalidate records — item keys depend only on the column
  index and the text.
- The table itself is not rendered — the board replaces it, so nothing appears twice.
- Columns whose headers are duplicated or empty get distinguishable names (e.g. `层级（第 2 组）`).
- **Multiple columns** chain through the table, and all adjacent pairs must be matched:

  ````markdown
  | 协议 | 端口 | 层级 |
  | --- | --- | --- |
  | HTTP | 80 | 应用层 |
  | IP | 0 | 网络层 |
  ````

- **One-to-many**: separate multiple entries in a cell with ` / `. Both sides split, and the entries
  stay grouped by the row they came from:

  ````markdown
  | 数据库 | 类型 |
  | --- | --- |
  | MySQL / PostgreSQL | 关系型 |
  | Redis / Memcached | 键值型 |
  ````

  This yields the items `MySQL`, `PostgreSQL`, `Redis`, `Memcached` in the first column — each of them
  links to the type on its own row, so `MySQL` and `PostgreSQL` both link to `关系型`.
- A table needs at least 2 columns, otherwise the question degrades with a warning.

### Fill in the blank

The marker is configurable (see **Blank marker** under Settings): `==answer==` (default),
`**answer**`, or both. The blank anchor `^bN` is **optional** — leave it out and blanks are numbered
automatically in order of appearance.

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

- Each marked span is one blank; the number of blanks comes from the question body.
- Write an explicit anchor only when you need to reference that blank from `blanks`:

  ````markdown
  最小长度是 ==20== ^len 字节。
  ````

- Anchors you don't write are numbered `b1`, `b2`, … by position; mixing explicit and automatic
  anchors in one question is fine.
- Markers inside code blocks and inline code are ignored, so you can write `==like this==` as an
  example in prose.
- Blanks not listed under `blanks` use strict matching (surrounding whitespace is ignored).
- In the UI the blanks are rendered **inline in the stem** as underlined gaps that grow with what you
  type: click a gap and type. The answer text never appears in the stem before submitting.

### Short answer

No fixed answer. The body is free-form, and a reference answer uses a **collapsed callout** so it
does not spoil the question.

````markdown
## 简述 TCP 与 UDP 的主要区别。 ^[[[计算机网络/传输层#TCP 与 UDP 对比]]]

从连接、可靠性、传输方式与适用场景四个方面作答。

> [!question]- 参考答案
> TCP 面向连接、可靠、字节流；UDP 无连接、不保证可靠、报文边界保留。

```quiz
type: essay
```
````

Grading is **self-assessed**: after answering, mark it as mastered or not mastered.

### When `type` is missing or invalid

The type is **never inferred from content shape**. Each problem degrades only its own question,
and never guesses an answer:

| Situation | Behaviour |
|---|---|
| `type` missing | Degrade; explain that `type` is required |
| `type` value invalid | Degrade; list the five valid values |
| `type: single`/`multi` but no list | Structure mismatch; not answerable |
| `type: match` but no table, or fewer than 2 columns | Structure mismatch |
| `type: blank` but no `==…==` | Structure mismatch |
| Option missing an anchor, or duplicate anchors | Not answerable |
| `answer` points at a nonexistent anchor | Not answerable |
| YAML parse error | Degrade; show the raw error |

## Commands

| Command | What it does |
|---|---|
| Open practice window | Opens the practice window (also on the ribbon icon): question-bank list → practice settings → practice |
| Insert question | Opens a dialog to build a question skeleton (type + stem title) and inserts it at the cursor |
| Validate current question bank | Parses the active note and reports how many questions are answerable vs. need fixing |
| Refresh quiz view | Forces the reading view to re-render the quiz blocks (also happens automatically after edits) |

The insert dialog is also available from the editor context menu (**right-click → Insert question**,
Markdown notes only). It asks for the type and the stem title only; the field names and syntax come from
the template, and the Markdown is previewed before it is written:

````markdown
## 单选题干

- 选项内容 ^a
- 选项内容 ^b

```quiz
type: single
answer: a
```
````

The placeholder text follows the **interface language**, so an English UI inserts English skeletons and a
Chinese UI inserts Chinese ones; the structure is what matters. The skeleton is an answerable question
from the start — replace the placeholder text and submit it in reading view. The heading level, the block
language, and the blank marker follow the settings below, and the insertion point is normalised so that the
question always ends up separated from its neighbours by exactly one blank line (no matter where the cursor
is, how many blank lines were there, or how many times you insert).

## The practice window

A sidebar view with three pages, so a whole practice session never leaves it (**Open practice window**, or the
ribbon icon):

1. **Question-bank list** — every question-bank file in the vault, grouped by folder and listed by path, with its
   data on the same row: total questions, answerable, how many need fixing, per-type counts, attempts and accuracy,
   and the date of the last attempt. A file that fails to parse reports its own error without breaking the list.
   Tick one or more files (or **Select all answerable**) to practise them together; the header totals the selection.
2. **Practice settings** — how to draw the questions this round:
   - **In order**: every candidate, in file order.
   - **Random sample**: shuffle and take N (0 or empty = everything).
   - **Only wrong answers**: keep questions whose last attempt was wrong.
   - **Question types**: any subset of single / multi / match / blank / essay; nothing ticked means all types.
     Unanswerable (degraded) questions never enter a session.
   - **Shuffle options**: randomise the question order and choice-option order (matching columns are always
     shuffled).
   The count line above the start button always shows how many questions are candidates and how many this round
   will actually ask, before you start.
3. **Practice** — one question at a time, rendered by the same card UI as in the note, with a progress bar,
   correct/wrong tallies, previous/next (and a jump box on longer rounds). Submitting grades through the same
   `QuizService`, so records are written back into the note exactly as in reading view. After submitting, the
   correct answer is revealed in place — correct choice options are outlined, blank answers are written into the
   gaps, matching questions draw the correct lines — followed by the explanation. **Peek** reveals the answer
   without scoring. The final page summarises the round, lists what you got wrong, and offers **Retry wrong only**.

Answers are keyed to file path + question id, so a round survives editing a file: the window re-parses a question
bank when it changes and again after each write-back.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Interface language | Follow Obsidian | `Follow Obsidian`, `English`, or `中文` — see [Interface language](#interface-language) |
| Block language | `quiz` | Change if it clashes; reload Obsidian afterwards |
| Blank marker | `==` | Which Markdown marker defines a blank: `==answer==`, `**answer**`, or both |
| Stem heading level | H2 | Decides which headings are questions |
| Question-bank path globs | empty | One per line, e.g. `题库/**` |
| Write records back | on | Turn off to grade in the UI only, leaving notes untouched |
| Per-question history cap | 10 | Records live in the note, so the detail list must be capped; `0` keeps only the summary |

## Interface language

The interface ships in **English and Chinese**. There is no separate translation file to install: both
message tables are bundled, and the plugin picks one when it loads — and again the moment you change the
setting.

- **Follow Obsidian** (the default) reads Obsidian's own language and uses Chinese when it is a Chinese
  variant (`zh`, `zh-CN`, `zh-TW`, …), English for everything else.
- The **Interface language** setting overrides that choice.
- Switching language re-renders the practice window, the settings tab, and the quiz cards already open in
  reading view immediately, and the templates inserted from then on use the new language. Command names in
  the command palette and the ribbon tooltip are registered when the plugin loads, so they change after a
  **reload**.
- Quiz **content** is never translated: a question written in Chinese stays Chinese, and the same goes for
  `explanation`, option text, and everything else inside the note. Only interface text — buttons, notices,
  parser warnings, grading notes, and the placeholder text of freshly inserted skeletons — follows the
  language setting.

## How records are stored

Everything is written into the question's own `quiz` block, so it travels with the note.

```yaml
type: single
answer: c
stats: { attempts: 12, correct: 9, lastResult: correct, lastAt: 2025-01-01T10:00:00Z }
rev: 8f3c1a
history:
  - { at: 2025-01-01T10:00:00Z, result: correct, ms: 4200 }
  - { at: 2025-01-01T09:58:11Z, result: wrong, answer: ["b"], ms: 6100 }
```

- `stats` is the never-truncated summary that powers accuracy figures.
- `history` is capped by the setting above; the oldest entries are dropped first.

Write-back rules:

1. Only `stats`, `history`, and `rev` are touched — everything else is preserved byte for byte.
2. Writes go through `Vault.process` (atomic read-modify-write); the block is re-located from the
   fresh file content, so edits made meanwhile are not overwritten.
3. The patched block is re-validated as YAML first; if validation fails the write is skipped rather
   than risking a corrupted note.

### Known limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Every answer rewrites the note | Git users see `git status` churn; Sync may conflict | Writes can be turned off in settings |
| Detail list must be capped | Full attempt history is not kept | `stats` is never truncated; raise the cap |
| Notes in a non-writable vault | Records cannot be persisted | The attempt still grades in the UI |

## Status

Implemented and covered by tests: the parser, stem preprocessing, grading for all five types, record
write-back, matching-board logic, question templates with their insertion positioning, the practice
card UI (choice options, click-to-connect multi-column matching with shuffling, inline click-to-type
blanks that grow with their content, short-answer self-assessment, and the clickable knowledge-point
link), the practice window
(question-bank list with per-file data, practice settings with type/sampling filters, and the
one-question-at-a-time round with in-place answer reveal and a final report), and the English/Chinese
interface with its language setting. Question-bank edits
trigger a debounced reading-view refresh and invalidate the window's cached parsing.

Not yet implemented: batching of multiple write-backs into one file write, and statistics that span
rounds (a mistake book, charts) beyond what the window computes for a single round.

> The card UI, the insert dialog, write-back, and the practice window have **not** been verified inside
> a real Obsidian instance. The logic layer (parsing, stem preprocessing, grading, write-back, template
> generation, insertion positioning, and session planning) is fully tested, and the window's three
> pages are exercised under jsdom, but DOM behaviour — line rendering between columns, focus handling
> on blank inputs, read-mode re-rendering, how the dialog renders in a real modal, and how the sidebar
> view lays out in a real workspace — can only be confirmed by hand in Obsidian.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The `quiz` block shows as a plain code block | The note is not detected as a question bank, or the block is not under a stem heading | Add `quiz: true`, check the heading level matches **Stem heading level** |
| The card appears but **Submit** does nothing | The question degraded (a warning is shown above the data block) | Fix what the warning names — usually `type`, a missing anchor, or a YAML error |
| Editing a question leaves the old card on screen | Reading view does not re-render code blocks on its own | The plugin refreshes automatically; otherwise run **Refresh quiz view** |
| Records stopped accumulating after a rename | The `id` was derived from the old heading text | Give the question an explicit `id`; **Records are keyed by file path + question id** |
| A `quiz` block is ignored entirely | It sits outside any heading that counts as a question | Move it under a stem heading |
| The data block language was changed | The processor is registered at load time | Reload Obsidian |
| Another plugin's `quiz` snippet stopped rendering | This plugin claimed the `quiz` block language | Change **Block language** in settings, then reload |

Supported languages: **English** (this file) and [**中文**](README.zh-CN.md).

## Contributing

- Keep `main.ts` to plugin lifecycle only; feature logic belongs in its own module under `src/`.
- `parser` / `stem` / `grade` / `writeback` / `hash` / `insert` / `session` must not import `obsidian`, so
  they stay testable under plain Node.
- Never hard-code interface text: add a key to `src/i18n/en.ts`, fill it in `src/i18n/zh.ts` (both tables
  are type-checked against each other), and read it through `t()`. Keep the same `{placeholders}` in both.
- When you change user-visible behaviour, update `README.md`, `README.zh-CN.md`, **and**
  `skills/easyquiz-authoring/SKILL.md` — the latter's examples are executed by `npm test`.
- Run `npm run build`, `npm test`, and `npm run lint` before opening a pull request; CI runs all three.

## License

0-BSD, see [LICENSE](LICENSE).
