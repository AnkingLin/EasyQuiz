# EasyQuiz

[![Node.js build](https://github.com/AnkingLin/EasyQuiz/actions/workflows/lint.yml/badge.svg)](https://github.com/AnkingLin/EasyQuiz/actions/workflows/lint.yml)

An Obsidian plugin for Markdown-native quiz practice. Questions are written as **plain Markdown**, rendered as an interactive card UI, and attempt records are written back **into the note**.

- Question bank: any Markdown file marked with `quiz: true` (or a `#quiz` tag).
- Question stem: a heading.
- Options / pairs / blanks: native lists, tables, and `==highlights==`.
- Machine data: a small `quiz` block under each question.
- Records: `stats` (summary) and a capped `history`, stored in the note itself.

## Development

```bash
npm install
npm run dev        # watch src/main.ts, rebuild main.js on change
npm run build      # tsc type check + production bundle
npm test           # bundle and run the test suite (88 cases)
npm run typecheck  # type check only
npm run lint       # eslint (eslint-plugin-obsidianmd)
```

Source layout:

```
src/main.ts        plugin entry: code-block processor, command, settings tab
src/parser.ts      question-bank parser (pure logic, no obsidian import)
src/types.ts       question model and parse-result types
src/stem.ts        stem preprocessing: strips what the interactive controls render (pure logic)
src/grade.ts       grading for the five question types (pure logic)
src/writeback.ts   record write-back: only stats/history/rev, validated before writing
src/hash.ts        stem hash (rev change detection)
src/runtime.ts     Obsidian adapter: file detection, dependency injection, atomic writes
src/view.ts        practice card rendering
tests/             parser / stem / grading / write-back tests and a question-bank fixture
```

`parser` / `stem` / `grade` / `writeback` / `hash` deliberately do **not** import `obsidian`, so they run under plain Node; every Obsidian API dependency is confined to `runtime.ts` and `view.ts`.

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
| `id` | no | Stable identifier; derived from the heading text when omitted. |
| `answer` | type-dependent | `single`: `c`; `multi`: `[a, b]`; `blank` and `match` and `essay`: not used. |
| `blanks` | no | Per-blank matching rules: `strict` / `ignoreCase` / `regex` / `accept`. |
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
## TCP 建立连接需要几次握手？

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
## 下列哪些属于传输层协议？

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
## 将协议与其默认端口配对

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
- In the UI the two sides are shown as two columns: **click an item, then click its answer**, and a
  connecting line is drawn between them. Clicking a connected item again removes its line.
- Each answer accepts a single line; connecting a second item to the same answer moves the line.
- The table itself is not rendered — the board replaces it, so nothing appears twice.
- **One-to-many**: separate multiple entries in a cell with ` / `. The first column then yields one
  match item per entry, and all of them accept the same answer:

  ````markdown
  | 数据库 | 类型 |
  | --- | --- |
  | MySQL / PostgreSQL | 关系型 |
  | Redis / Memcached | 键值型 |
  ````

  This yields two match items, "MySQL" and "PostgreSQL", both accepting "关系型" — so pairing
  "关系型" with either one is correct.
- A table needs at least 2 columns, otherwise the question degrades with a warning.

### Fill in the blank

`==answer==` is the capture group, `^bN` is the blank anchor.

````markdown
## 补全 TCP 首部字段

TCP 首部的最小长度是 ==20== ^b1 字节，其中 ==序号== ^b2 字段用于标识本报文段的数据的第一个字节。

```quiz
type: blank
blanks:
  b1: { accept: ["20", "20字节", "二十"] }
  b2: { ignoreCase: true }
```
````

- Each `==…== ^bN` is one blank; the number of blanks comes from the question body.
- Blanks not listed under `blanks` use strict matching (surrounding whitespace is ignored).
- In the UI the blanks are rendered **inline in the stem** as underlined gaps: click a gap and type.
  The answer text never appears in the stem before submitting.

### Short answer

No fixed answer. The body is free-form, and a reference answer uses a **collapsed callout** so it
does not spoil the question.

````markdown
## 简述 TCP 与 UDP 的主要区别。

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

## Settings

| Setting | Default | Notes |
|---|---|---|
| Block language | `quiz` | Change if it clashes; reload Obsidian afterwards |
| Stem heading level | H2 | Decides which headings are questions |
| Question-bank path globs | empty | One per line, e.g. `题库/**` |
| Write records back | on | Turn off to grade in the UI only, leaving notes untouched |
| Per-question history cap | 10 | Records live in the note, so the detail list must be capped; `0` keeps only the summary |

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
write-back, and the practice card UI (choice options, click-to-connect matching, inline click-to-type
blanks, short-answer self-assessment).

Not yet implemented: debounced batching of writes, external-modification detection
(`vault.on('modify')`), alternate renderers (review mode / single-question panel), and statistics such
as a mistake book.

> The card UI and write-back have **not** been verified inside a real Obsidian instance. The logic
> layer (parsing, stem preprocessing, grading, write-back) is fully tested, but DOM behaviour —
> line rendering between columns, focus handling on blank inputs — can only be confirmed by hand in
> Obsidian.
