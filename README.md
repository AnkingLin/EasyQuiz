# EasyQuiz

[![Node.js build](https://github.com/AnkingLin/EasyQuiz/actions/workflows/lint.yml/badge.svg)](https://github.com/AnkingLin/EasyQuiz/actions/workflows/lint.yml)

[中文](README.zh-CN.md) · **English**

**Write questions inside your notes, practise them as cards, and let an AI follow the same authoring spec.**

Questions are plain Markdown. EasyQuiz renders each `quiz` block as an interactive card in reading view and writes the attempt record back into the note itself — so your progress lives with the questions, inside your vault. This release is about embedded authoring: write in the note, practise in the note, and let the bundled AI skill author alongside you. Finished questions can also be embedded in other notes with `![[bank#stem]]` and answered right there.

| Highlight | What it gives you |
|---|---|
| **AI skill** | Ships [`skills/easyquiz-authoring/SKILL.md`](skills/easyquiz-authoring/SKILL.md): skeletons for all five question types, anchor and degrade rules, the knowledge-link convention. AI agents use it to add, fix, or insert questions; every skeleton in the spec is parsed and graded by the test suite. |
| **Five question types** | Single choice, multiple choice, matching, fill in the blank, short answer. The `type` field alone decides the type — the plugin never guesses from the shape of the content. |
| **Stem detection** | Fixed heading level or automatic nearest-heading matching; the stem is only the nearest block, forced blank lines around tables do not break it, and Markdown renders the Obsidian way. |
| **Records and review** | Attempts are written back into the question's own `quiz` block; revisiting an answered question shows what you picked and updates the header stats, and the header's edit button jumps back to the source note. |

![One single-choice question: the Markdown in the note on the left, the rendered card on the right](docs/assets/en/card-anatomy.png)

## Where do I start?

| What you want to do | Read this |
|---|---|
| Have an AI write, fix, or insert questions | [AI skill](#ai-skill) |
| Get one question working first | [Quick start](#quick-start) |
| Pick a type and copy a skeleton | [The five question types](#the-five-question-types) |
| Look up fields, anchors, blank rules, degrade behaviour | [How exactly do I write a question?](#how-exactly-do-i-write-a-question) |
| Answer one question inside another note | [How do I reference a question in another note?](#how-do-i-reference-a-question-in-another-note) |
| Tie a question back to a knowledge note | [How do I tie a question to my notes?](#how-do-i-tie-a-question-to-my-notes) |
| Practise a whole question bank | [How do I practise a whole question bank?](#how-do-i-practise-a-whole-question-bank) |
| See where answers are stored | [Where do my answers go?](#where-do-my-answers-go) |
| Find commands and settings | [What else can the plugin do for me?](#what-else-can-the-plugin-do-for-me), [Settings](#settings) |
| See what changed | [What's new](#whats-new) |

## AI skill

The repository ships an authoring spec for AI agents: [`skills/easyquiz-authoring/SKILL.md`](skills/easyquiz-authoring/SKILL.md). It is not a prompt template; it is the plugin's author handbook — the heading and knowledge-link convention, skeletons for the five question types, anchor and blank rules, fields written by the plugin, degrade behaviour, and when to use `question` / `distractors`. Every skeleton in the spec is parsed and graded by `npm test`, so a question written from it is guaranteed to be answerable.

**When to use it**

- Fill a note with questions: let the AI read the knowledge note and write single-choice, blank, or matching questions into a new bank.
- Repair an old bank: check for unanswerable questions or records that no longer line up, and fix them one by one.
- Insert a question into a handout or revision page: ask for a full stem via the `question` field, then embed it with `![[bank#stem]]`.

**How to use it**

1. Put `skills/easyquiz-authoring/` where the agent can read it (for example `.agents/skills/` inside the vault, or point the agent at this path in the repository).
2. Have the agent read `SKILL.md` before writing, and state the scope: one embedded question or a whole bank, and whether existing content may be changed.
3. After writing, run **Validate current quiz file**, or check that the card is answerable; when in doubt run `npm test`, which executes the skeletons from the spec.

**Two hard rules for the AI** (the same ones the spec states)

- When **inserting one question into a note**, prefer `question` to override the displayed stem and `distractors` to add decoys; when **generating a whole bank**, do not write either field unless the user explicitly asks.
- The stem body holds only the block the type needs: the option list for choice questions, the data table for matching, the sentence with blanks for fill-in-the-blank, and the prose for short answers. Farther blocks are not shown, and prose attached to the options or table is displayed as "supplement".

![A prompt to an AI agent on the left and the card it writes on the right, using the question field and two decoy ports](docs/assets/en/ai-authoring.png)

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

   ![The card after submitting a correct answer](docs/assets/en/card-single.png)

4. Run **Open practice window** in the command palette (or click the ribbon icon) to practise a whole
   question bank, or several at once.

That is the whole loop. Everything below answers one question at a time; read only what you need.

## The five question types

> Shortest path: pick `type` → write the stem body (list / table / `==blank==` / prose) → put a `quiz` block at the end of the question → end the heading with `^[[[knowledge note]]]`. Every type below has a copyable skeleton; fields, anchors, and degrade rules are in [How exactly do I write a question?](#how-exactly-do-i-write-a-question).

Five types, and the type always comes from the `type` field — it is **never guessed from the shape of the
content**. Pick one:

| Type | You write | The card gives you |
|---|---|---|
| `single` | A Markdown list, one correct anchor | Click one option |
| `multi` | A Markdown list, several correct anchors | Click several options |
| `match` | A Markdown table (its row order *is* the answer) | Click to connect adjacent columns |
| `blank` | `==highlights==` in the prose | Type into the gaps, inline |
| `essay` | Free prose + a collapsed reference answer | Write, then self-assess |

### Single choice

Options are a native list. Answers are tied to **anchors** (`^a`) rather than positions, so when you write
anchors yourself, inserting, deleting, or reordering an option never misaligns your records. Anchors are
optional: if no option has one, options are numbered `a`, `b`, `c`… from top to bottom, so `answer: c` still
means the third option. If only some options have anchors, only those appear on the card; the unanchored
ones are hidden.

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

After submitting, the correct option is outlined and the explanation appears underneath — nothing is
hidden behind a separate answer key:

![A single-choice card in review: your answer, the correct option outlined, and the explanation below](docs/assets/en/card-single.png)

Stems, options and explanations are all drawn by Obsidian's own renderer, so `**bold**`, `` `code` ``,
`![[image.png]]` embeds and `$formula$` work on the card and in the practice window.

Both themes are supported, since the card is drawn with Obsidian's own theme variables:

![The same card on a dark theme](docs/assets/en/card-single-dark.png)

Choice questions can carry `distractors` — a count plus a candidate pool of decoys — and `question` overrides the displayed stem. The card below uses both; decoys are drawn fresh on every attempt and never collide with the options you wrote:

![A single-choice card using question and distractors: a full stem and two extra decoy ports](docs/assets/en/card-distractors.png)

### Multiple choice

Same shape, but `answer` is a list; the anchor rules are the same as for single choice. Getting it partly
right counts as wrong, and the review lists every correct anchor so you can see what you missed:

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

![A multiple-choice card answered incorrectly, with all correct options listed in the review](docs/assets/en/card-multi.png)

### Matching

Written as a **multi-column table**. The table's original row order *is* the correct answer, and every
column is shuffled independently at practice time, so the order never gives it away.

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

Click an item on the left, then its partner on the right, and the connection is drawn between them:

![Connecting items one by one in a matching question](docs/assets/en/gif-match.gif)

- **Only adjacent columns connect.** A row `A | B | C` means the links `A–B` and `B–C`; clicking column 1
  and then column 3 is rejected.
- **Direction does not matter** — left-then-right and right-then-left make the same link.
- **Order is shuffled**, and duplicate entries inside one column are merged.
- **Several items may point at the same item** (merged options), e.g. `MySQL` and `PostgreSQL` both
  linking to `关系型`.
- Adding or reordering rows does not invalidate records: an item's key depends only on its column and text.
- The table itself is not rendered — the board replaces it, so nothing appears twice.

### Fill in the blank

Mark the answers inside the prose. The blank anchor `^bN` is **optional** — leave it out and blanks are
numbered in order of appearance.

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

The gaps are rendered **inline in the stem** and grow as you type, so the sentence stays readable while
you fill it in:

![Typing into the blanks, which grow with their content](docs/assets/en/gif-blank.gif)

After submitting, the answers are written into the gaps in place:

![A blank question reviewed, with the answers written into the gaps](docs/assets/en/card-blank.png)

- The marker is configurable: `==answer==` (default), `**answer**`, or both.
- Markers inside code blocks and inline code are ignored, so you can write `==like this==` as an example.
- Blanks not listed under `blanks` use strict matching (surrounding whitespace is ignored).
- The answer text never appears in the stem before you submit.

### Short answer

No fixed answer. The body is free prose, and a reference answer goes in a **collapsed callout** so it does
not spoil the question:

````markdown
## 简述 TCP 与 UDP 的主要区别。 ^[[[计算机网络/传输层#TCP 与 UDP 对比]]]

从连接、可靠性、传输方式与适用场景四个方面作答。

> [!question]- 参考答案
> TCP 面向连接、可靠、字节流；UDP 无连接、不保证可靠、报文边界保留。

```quiz
type: essay
```
````

Grading is **self-assessed**: after writing, mark it as mastered or not mastered.

![A short-answer card with the reference answer in a collapsed callout](docs/assets/en/card-essay.png)

### What if I get the type wrong?

Nothing is guessed, and nothing else breaks. Each problem degrades **only its own question** into a
diagnostic card that names the line and the fix:

![A degraded question showing a diagnostic card that names the missing field and the line](docs/assets/en/card-diagnostic.png)

| Situation | Behaviour |
|---|---|
| `type` missing | Degrade; explain that `type` is required |
| `type` value invalid | Degrade; list the five valid values |
| `type: single`/`multi` but no list | Structure mismatch; not answerable |
| `type: match` but no table, or fewer than 2 columns | Structure mismatch |
| `type: blank` but no `==…==` | Structure mismatch |
| Some choice options have no anchor | Those options are hidden; the anchored options stay answerable |
| Duplicate option anchors | Not answerable |
| `answer` points at a nonexistent anchor | Not answerable |
| YAML parse error | Degrade; show the raw error |

## How exactly do I write a question?

### Question bank file

A file is treated as a question bank when any of these hold:

1. frontmatter `quiz: true` (**preferred** — keeps the body clean);
2. a file-level `#quiz` tag (frontmatter tags or an inline tag);
3. a configured path glob matches (e.g. `题库/**`).

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

### Anatomy of a question

- A question spans from its stem heading to the **next heading of the same or higher level**.
- The heading text is the question title; end it with `^[[[]]]` to record the source knowledge point.
- The `quiz` block is **required**: the question type comes from its `type` field.
- Put the data block at the end of the question, or right after the heading — both are equivalent.

**Stem heading levels.** By default, only headings at the configured level are questions (**Fixed level**,
one level per file). Switch **Stem heading matching** to **Auto** and every heading that owns a `quiz` block
becomes a question, at whatever level it is — so a file can mix H2 grouping headings with H3 questions. In
Auto mode a question runs to the next heading that also owns a `quiz` block; headings in between that own no
block stay inside the question above as sub-headings.

**What the card shows.** The stem is gathered upward from each type's **target block** (a block is a run of
consecutive non-blank lines):

- Target block: `single` / `multi` use the nearest option list; `match` the nearest table; `blank` the nearest block with `==blank==` markers; `essay` the last block.
- Walking up: the block right above the target counts as the stem; further up, only blank lines **hugging a table** (the padding table syntax needs) are crossed — an ordinary blank line stops the walk. A table therefore keeps its surrounding prose together with the question.
- `single` / `multi`: non-list lines inside the target block appear as a supplement under the stem, and no ordinary block above is taken then; tables inside the target belong to the question and stay visible.
- `match`: prose above the table is the stem, prose after the table is the supplement. Only the **nearest table** becomes the matching structure; tables above it are ordinary content and stay in the stem.
- `blank`: the target block plus any tables/prose picked up by the walk is the stem.
- `essay`: the last block. A reference callout and the blocks above it stay in the shown stem (collapsed), gathered by the same upward walk, so tables above the callout are crossed too.

Stems are rendered with Obsidian's Markdown rules — tables, quotes, and code all display as in a note — and
the stem containers carry `markdown-rendered` so tables get the theme's table styling. Blank lines are inserted
around tables so the practice page matches the note preview. Only the controls (option list, matching table,
blank fields) are taken over. Blocks further up are not shown, so a preceding question cannot leak into this
one. When the heading must stay short but the question needs a full sentence, use the `question` field (see
below).

### Metadata fields

| Field | Required | Notes |
|---|---|---|
| `type` | **yes** | `single` / `multi` / `match` / `blank` / `essay`. The *only* thing that decides the type. |
| `id` | no | Stable identifier; derived from the heading text (with the `^[[[]]]` knowledge link excluded) when omitted. |
| `answer` | type-dependent | `single`: `c`; `multi`: `[a, b]`; `blank` and `match` and `essay`: not used. |
| `blanks` | no | Per-blank matching rules: `strict` / `ignoreCase` / `regex` / `accept`. Keys are blank anchors. |
| `shuffle` | no | Shuffle this question's choice options. Default `false`; `match` is always shuffled. |
| `explanation` | no | Explanation text, rendered as Markdown (bold, inline code, images, formulas). May also be written inline as a `> [!note]- 解析` callout. |
| `score` | no | Points, default 1. |
| `stats` | no | **Written by the plugin**: `attempts` / `correct` / `lastResult` / `lastAt`. |
| `rev` | no | **Written by the plugin**: stem hash, used to detect edits. |
| `question` | no | Replaces the heading text on the card; the heading still supplies the `id` and the knowledge link. |
| `distractors` | no | Choice questions only: `distractors: 2` adds 2 decoys, or `distractors: { count: 2, pool: [ ... ] }` names the candidate pool. Redrawn after every attempt; review shows the set used for that answer. |

`stats` and `rev` are maintained automatically — **authors never write them**.

Write `question` and `distractors` only when **inserting a single question into an existing note**. When
generating a whole bank file, leave them out unless explicitly asked: banks keep the stem on the heading and
stay plain and easy to review.

### Anchors

Choice options and blanks use Obsidian's native block-ID syntax `^id`, so answers are tied to anchors
rather than positions:

````markdown
- A option ^a
- B option ^b

The minimum TCP header length is ==20== ^b1 bytes.
````

Choice-option anchors are optional. With none at all, options are numbered `a`, `b`, `c`… by position; with
only some, the unanchored options are hidden from the card. Write explicit anchors when a question's options
may be reordered and its records must stay attached to the same option.

Matching tables do **not** use anchors: a `^id` in a table cell is literal text, and row-level anchors are
unsupported. Match records are keyed by row-content hash plus row index, so editing a table marks the
affected records as "stem changed" rather than silently discarding them.

### Matching details

- A table is only read as a matching question when `type: match`; tables in other question types are
  ordinary prose and are not graded.
- **An item can carry more than one line per neighbouring column pair.** Clicking a pair that is already
  connected removes that line, so reconnecting means removing the old line first.
- Clicking a connected item only selects it; it does not silently drop its line.
- **Duplicate entries are merged**: within one column, items with the same text appear once.
- Columns whose headers are duplicated or empty get distinguishable names (e.g. `层级（第 2 组）`).
- **Multiple columns** chain through the table, and all adjacent pairs must be matched:

  ````markdown
  | 协议 | 端口 | 层级 |
  | --- | --- | --- |
  | HTTP | 80 | 应用层 |
  | IP | 0 | 网络层 |
  ````

- **One cell is one entry.** A cell's text is kept as written, so `MySQL / PostgreSQL` is a single item
  named `MySQL / PostgreSQL`, not two. To make one item answer for several, repeat the row — the shared
  text is merged into one node, and that node keeps every line it needs:

  ````markdown
  | 数据库 | 类型 |
  | --- | --- |
  | MySQL | 关系型 |
  | PostgreSQL | 关系型 |
  | Redis | 键值型 |
  ````

  This yields `MySQL`, `PostgreSQL`, `Redis` in the first column and `关系型`, `键值型` in the second.
  `关系型` appears once but carries two lines, one to `MySQL` and one to `PostgreSQL`.
- A table needs at least 2 columns, otherwise the question degrades with a warning.

### Blank matching rules

- Each marked span is one blank; the number of blanks comes from the question body.
- Write an explicit anchor only when you need to reference that blank from `blanks`:

  ````markdown
  最小长度是 ==20== ^len 字节。
  ````

- Anchors you don't write are numbered `b1`, `b2`, … by position; mixing explicit and automatic anchors in
  one question is fine.

## How do I tie a question to my notes?

End the stem heading with `^[[[]]]` — `^[`, an Obsidian wikilink, `]`:

```markdown
## TCP 建立连接需要几次握手？ ^[[[计算机网络/传输层#TCP 三次握手]]]
```

- The `^[ … ]` wrapper marks the link as an annotation of the stem rather than ordinary question text. The
  `[[…]]` inside is a real wikilink: it renders as a link, and the question-bank note appears in the
  target's backlinks panel — visible as the **Knowledge point** row on the card.
- The parser **strips it from the displayed title and from the derived id**, so retargeting a link never
  disconnects accumulated `stats` / `history`. The target is available as `QuizQuestion.knowledgeLink`.
- `rev` (the stem hash) is computed from the stem body, not the heading, so **relinking a question does
  not mark its records as "stem changed"**.
- Only a trailing `^[[[]]]` counts. The older two-bracket form `^[[…]]` is still recognised. Write a plain
  `[[]]` inside the stem body when you want an inline link in the question text; only the heading link is
  stripped.
- Links are optional — a question without one simply has `knowledgeLink: null`.

The full authoring convention, including the five question types and the review checklist, lives in
[`skills/easyquiz-authoring/SKILL.md`](skills/easyquiz-authoring/SKILL.md). It is written for AI agents
authoring or reviewing a bank, and its examples are executed by the test suite, so the documented
skeletons are guaranteed to parse.

## How do I reference a question in another note?

There are two ways, and both render the question as a **real, answerable card** right where you write it.

### Reference it by question id (recommended)

Give the question an `id` in its bank file (if omitted, one is derived from the stem heading — an explicit
id is clearer), then reference it with **inline code** from any note:

```markdown
This week: `tcp-handshake`
```

- Only a code span that is **exactly one question id** counts as a reference. Ordinary code, fenced code
  blocks and code inside headings are left alone.
- A vault-wide unique id resolves directly. If several questions share the id, one in the current note wins;
  if it is still ambiguous the code is left as written.
- You can reference several questions in one paragraph. The reference itself never participates in grading,
  and attempts are still written back to the question's own bank note.
- Handy for assembling a review note, handout or mock exam without copying question text.

### Embed it by stem heading

Embedding by stem heading works the same way:

```markdown
![[计算机网络/第三章#TCP 建立连接需要几次握手？]]
```

- The subpath is the **stem heading text, with the trailing `^[[[]]]` knowledge link left out**.
- A subpath that does not name a stem heading is left completely alone, so ordinary embeds such as
  `![[Some note#Some section]]` keep behaving exactly as Obsidian renders them.
- Block references (`![[bank#^block-id]]`) and footnote references are not questions and are also left alone.

Both forms are deliberately **not** Obsidian's built-in heading embed. Two reasons: a plain embed would show
the option list and the raw `quiz` data block instead of a card, and Obsidian's heading lookup normalises
punctuation — which the trailing `^[[[knowledge link]]]` derails, making it silently fall back to rendering
the **entire** bank file. EasyQuiz recognises these references itself and replaces them with a card.

## How do I practise a whole question bank?

**Open practice window** (or the ribbon icon) opens the window in the right sidebar, with three pages, so a
whole session never leaves it. The same window can also be opened in a main-area tab or in its own window —
see **Open practice window in a new tab** / **Open practice window in a new window** in the command palette.
Each location keeps one window of its own, so a sidebar session and a tab session can run side by side.

### 1. Question-bank list

Every question-bank file in the vault, grouped by folder, each with its data on the same row: total
questions, answerable, how many need fixing, per-type counts, attempts, accuracy, and the date of the last
attempt. A file that fails to parse reports its own error without breaking the list.

With a large library, this page gives you three ways to narrow it down:

- **Search** — filters by file name or path as you type, and reports **how many files matched**. Searching
  never touches the files you have already ticked.
- **Fold folders** — click a folder header to collapse or expand that group; **Collapse all** / **Expand
  all** do every group at once. The folded state is saved with the workspace.
- **Tick a whole folder** — every folder header carries a checkbox that selects or clears the group, and
  shows a half-tick when only part of it is selected.

Tick one or more files — or **Select all answerable** (which applies to the current search results) — to
practise them together:

![The question-bank list, with per-file data and two files ticked](docs/assets/en/window-list.png)

### 2. Practice settings

Decide how to draw this round, and see **how many questions it will actually ask before you start**:

- **In order** — every candidate, in file order.
- **Random sample** — shuffle and take N (0 or empty = everything).
- **Only wrong answers** — keep questions whose last attempt was wrong.
- **Question types** — any subset; nothing ticked means all types.
- **Shuffle** — randomise question order and choice-option order. Option order is derived from the round's
  seed, so it stays put while you review an answer or step between questions, and only re-shuffles when a
  new round starts. Grading is by anchor, so a shuffled option never changes what counts as correct.

![Practice settings: how to draw, which types, and shuffle, with the planned count above the start button](docs/assets/en/window-picker.png)

Degraded questions never enter a session, so a broken question can't quietly eat a slot.

### 3. Practice

One question at a time, rendered by the same card UI as in the note, with a sticky progress bar, a
correct/wrong tally, and previous/next (plus a jump box on longer rounds). Submitting grades through the
same service, so records are written back exactly as in reading view:

![The practice page: progress bar, a multiple-choice question, and navigation](docs/assets/en/window-practice.png)

- **Peek** reveals the answer without scoring it.
- **Open note** in the card header jumps to the question in its bank and puts the cursor on its heading;
  when the note is already open, that tab is reused.
- **Clear question records** on the practice page resets only the current question's attempts and history;
  **Clear records** on each row of the bank list resets a whole bank. Both ask for a second click.
- The last page summarises the round, lists what you got wrong, and offers **Retry wrong only**.

Because answers are keyed to file path + question id, a round survives editing a file: the window re-parses
a bank when it changes, and again after each write-back. The command palette also has **Practise this
bank**, which starts a round for the bank currently open (or selected in the file explorer).

## Where do my answers go?

Everything is written into the question's own `quiz` block, so it travels with the note:

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
2. Writes go through `Vault.process` (atomic read-modify-write); the block is re-located from the fresh
   file content, so edits made meanwhile are not overwritten.
3. The patched block is re-validated as YAML first; if validation fails the write is skipped rather than
   risking a corrupted note.

### Known limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| Every answer rewrites the note | Git users see `git status` churn; Sync may conflict | Writes can be turned off in settings |
| Detail list must be capped | Full attempt history is not kept | `stats` is never truncated; raise the cap |
| Notes in a non-writable vault | Records cannot be persisted | The attempt still grades in the UI |

## Can I use the interface in my language?

Yes — the interface ships in **English and Chinese**. There is no separate translation file to install:
both message tables are bundled, and the plugin picks one when it loads, and again the moment you change
the setting.

- **Follow Obsidian** (the default) reads Obsidian's own language and uses Chinese for a Chinese variant
  (`zh`, `zh-CN`, `zh-TW`, …), English for everything else.
- The **Interface language** setting overrides that choice.
- Switching language re-renders the practice window, the settings tab, and the quiz cards already open in
  reading view immediately. Command names in the palette and the ribbon tooltip are registered when the
  plugin loads, so they change after a **reload**.
- Quiz **content** is never translated: a question written in Chinese stays Chinese, and the same goes for
  `explanation`, option text, and everything else inside the note. Only interface text follows the setting.

## What else can the plugin do for me?

| Command | What it does |
|---|---|
| Open practice window | Opens the practice window in the right sidebar (also on the ribbon icon) |
| Open practice window in a new tab | Opens the practice window as a main-area tab |
| Open practice window in a new window | Opens the practice window in its own window (desktop only) |
| Insert question | Opens a dialog to build a question skeleton and inserts it at the cursor |
| Practise this bank | Starts a round for the bank currently open (same entry in the file explorer menu) |
| Validate current question bank | Reports how many questions are answerable vs. need fixing |
| Refresh quiz view | Forces the reading view to re-render the quiz blocks (also happens after edits) |

The insert dialog is also on the editor context menu (**right-click → Insert question**, Markdown notes
only). It asks for the type and the stem title, previews the Markdown before writing, and follows the
interface language — so an English UI inserts English skeletons:

![The insert-question dialog, showing the type, the stem heading, and a live Markdown preview](docs/assets/en/modal-insert.png)

Question banks can also be started straight from the **file explorer**: pick **⋯ → Practise this question
bank** next to a bank file in the file list or the file tree, and the practice window opens **directly on
that bank's practice settings** — no need to open the window and then hunt for the file. The item only
appears for Markdown question banks; multi-selections and other files are left alone.

## Settings

| Setting | Default | Notes |
|---|---|---|
| Interface language | Follow Obsidian | `Follow Obsidian`, `English`, or `中文` |
| Block language | `quiz` | Change if it clashes; reload Obsidian afterwards |
| Blank marker | `==` | Which Markdown marker defines a blank: `==answer==`, `**answer**`, or both |
| Stem heading level | H2 | In **Fixed level** mode, decides which headings are questions; hidden in **Auto** mode |
| Stem heading matching | Fixed level | **Fixed level**: only the configured heading level counts; **Auto**: every heading that owns a `quiz` block is a question, so levels can be mixed |
| Question-bank path globs | empty | One per line, e.g. `题库/**` |
| Write records back | on | Turn off to grade in the UI only, leaving notes untouched |
| Per-question history cap | 10 | Records live in the note, so the detail list must be capped; `0` keeps only the summary |

## Installing into a vault

1. Create `<Vault>/.obsidian/plugins/easy-quiz/`.
2. Copy `main.js`, `manifest.json`, and `styles.css` into it.
3. Reload Obsidian and enable the plugin under **Settings → Community plugins**.

## What's new

### 1.1.0 — embedded authoring

- **AI skill.** `skills/easyquiz-authoring/SKILL.md` documents the five question types, anchors, degrade rules, and the knowledge-link convention; AI agents use it to add questions, repair banks, and insert single questions into handouts. Its examples are parsed and graded by the test suite.
- **Embedded authoring.** The metadata block gained `question` (overrides the displayed stem) and `distractors` (adds decoys to choice questions, with a count and an optional pool, re-drawn on every attempt). The card header has an **edit** button that opens the question's source note: it jumps to the question's heading like a backlink: the cursor lands on the heading in edit mode, and reading view scrolls to it with the native highlight. An already-open tab is reused. `![[bank#stem]]` renders an answerable card inside another note.
- **Stem detection.** Headings can be matched **automatically**: any nearest heading whose own section contains a `quiz` block is a question, regardless of level. The stem is taken upward from the type's target block — the adjacent block belongs to the stem, and farther blocks only when the blank line around a table is a forced one; an ordinary blank line stops the walk. Choice prose attached to the options becomes the "supplement", matching uses only the nearest table, and the short-answer callout stays with the block above it.
- **Obsidian-style rendering.** The stem and supplement carry `markdown-rendered`, and blank lines are inserted around tables so the practice page matches the note preview; options, explanations, and matching cells render Markdown too.
- **Practice and records.** Folder checkboxes show a partial state, the bank list notices file changes when you come back, questions and banks can clear their records, the command palette can start a bank directly, and revisiting an answered question shows that attempt with updated stats.
- **Steadier decoys.** Distractors are re-drawn after every attempt, and review shows the group you actually saw.

Each version is announced once. Older releases are on [GitHub Releases](https://github.com/AnkingLin/EasyQuiz/releases).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| The `quiz` block shows as a plain code block | The note is not detected as a question bank, or the block is not under a stem heading | Add `quiz: true`, check the heading level matches **Stem heading level** |
| The card appears but **Submit** does nothing | The question degraded (a warning is shown above the data block) | Fix what the warning names — usually `type`, a duplicate anchor, or a YAML error |
| Editing a question leaves the old card on screen | Reading view does not re-render code blocks on its own | The plugin refreshes automatically; otherwise run **Refresh quiz view** |
| Records stopped accumulating after a rename | The `id` was derived from the old heading text | Give the question an explicit `id`; records are keyed by file path + question id |
| A `quiz` block is ignored entirely | It sits outside any heading that counts as a question | Move it under a stem heading |
| The data block language was changed | The processor is registered at load time | Reload Obsidian |
| Another plugin's `quiz` snippet stopped rendering | This plugin claimed the `quiz` block language | Change **Block language** in settings, then reload |

## Development

```bash
npm install
npm run dev        # watch src/main.ts, rebuild main.js on change
npm run build      # tsc type check + production bundle
npm test           # bundle and run the test suite (425 cases)
npm run typecheck  # type check only
npm run lint       # eslint (eslint-plugin-obsidianmd)
npm run assets     # regenerate the screenshots and GIFs used by the READMEs
```

The suite has two layers:

- **Pure logic** (`parser`, `stem`, `grade`, `writeback`, `match-board`, `insert`, `session`): plain node, no DOM.
- **DOM** (`tests/quiz-match-dom.test.ts`, `tests/quiz-insert-modal.test.ts`, `tests/quiz-practice-view.test.ts`,
  `tests/quiz-knowledge-link.test.ts`, `tests/quiz-file-menu.test.ts`, `tests/quiz-i18n.test.ts`):
  renders the real card and board through `renderQuizCard` under jsdom and clicks its nodes, so click handling,
  line targets, per-column isolation, the `MarkdownRenderer` contract and the knowledge-point link are checked
  rather than assumed; the insert dialog is opened through `InsertQuestionModal` and its controls are driven;
  the practice window is opened through `PracticeView` and walked through all three of its pages — including
  the list's search, folder folding and per-folder selection; and the file-explorer menu is driven through
  its real event handlers.
  `tests/dom.ts` installs the Obsidian-style DOM helpers (`createDiv`, `addClass`, …) and
  `tests/obsidian-stub.ts` stands in for the type-only `obsidian` package.

`tests/quiz-skill-doc.test.ts` closes the loop between documentation and code: it reads
`skills/easyquiz-authoring/SKILL.md`, extracts every marked example, and feeds it to the real parser and
grader. A documented skeleton that cannot be answered fails the suite.

`tests/quiz-i18n.test.ts` covers the other direction: the two message tables must expose the same keys and
the same `{placeholders}`, and the English interface is rendered for real (card, parser warning, practice
window) rather than only looked up.

### Regenerating the README images

Every screenshot and GIF in this document is produced by `npm run assets`, which runs the plugin's real
code in a headless browser:

- the fixtures in `tools/readme-assets/browser/fixtures.ts` are parsed by the real `parseQuizFile`;
- the cards are drawn by the real `renderQuizCard`, the window by the real `PracticeView`, and the dialog
  by the real `InsertQuestionModal`;
- the styling comes from the plugin's own `styles.css`, over a small approximation of Obsidian's default
  theme (`tools/readme-assets/theme.css`).

So the images show genuine renderer output, but note the honest caveat: they are **not screenshots of a
real Obsidian window**. The surrounding chrome (window frame, note header) is a stand-in, and the GIFs are
frame sequences the generator produces by driving real click/type events — not a screen recording. Output
goes to `docs/assets/<en|zh>/`, so each README shows its own interface language.

### Source layout

```
src/main.ts          plugin entry: code-block processor, commands, view registration, settings tab
src/parser.ts        question-bank parser (pure logic, no obsidian import)
src/types.ts         question model and parse-result types
src/stem.ts          stem preprocessing: strips what the interactive controls render (pure logic)
src/embed.ts         `![[bank#question]]` embed matching: src parsing, heading keys, question lookup (pure logic)
src/plain-text.ts    display-only plain text for option/answer text in review notes (pure logic)
src/grade.ts         grading for the five question types (pure logic)
src/writeback.ts     record write-back: only stats/history/rev, validated before writing
src/hash.ts          stem hash (rev change detection)
src/match-board.ts   matching board state machine: adjacent-column links (pure logic)
src/session.ts       practice planning: file summaries, filtering, sampling, progress (pure logic)
src/runtime.ts       Obsidian adapter: file detection, dependency injection, atomic writes
src/view.ts          practice card rendering (including the header's knowledge-point link)
src/practice-view.ts practice window: question-bank list / practice settings / practice
src/whats-new.ts     update notes by version and the upgrade check (pure logic)
src/whats-new-modal.ts the one-time What's new dialog
src/insert.ts        question templates and insertion positioning (pure logic)
src/insert-modal.ts  insert-question dialog and the editor write
src/file-menu.ts     the file explorer menu entry that starts practising a bank
src/labels.ts        question-type labels and default stem titles, shared by card/dialog/window (pure logic)
src/i18n/            English/Chinese message tables and the language state (pure logic)
skills/              agent-facing authoring spec (SKILL.md), examples verified by the test suite
tests/               parser / stem / grading / write-back / insert / session tests, the window tests, a fixture
tools/readme-assets/ README screenshot & GIF generator (see above)
```

`parser` / `stem` / `grade` / `writeback` / `hash` / `insert` / `session` / `labels` / `i18n` deliberately
do **not** import `obsidian`, so they run under plain Node; every Obsidian API dependency is confined to
`runtime.ts`, `view.ts`, `practice-view.ts`, `insert-modal.ts`, and `file-menu.ts`. That includes the
message tables: they are plain objects, so the parser can produce a localized warning without touching the
Obsidian API.

The stem is rendered **without** the parts that get their own interactive control — the option list, the
matching table, and the `==answer==` text are stripped so that nothing is displayed twice.

## Status

Implemented and covered by tests: the parser, stem preprocessing, grading for all five types, record
write-back, matching-board logic, question templates with their insertion positioning, the practice card UI
(stems, options, explanations and matching cells rendered as Markdown, click-to-connect multi-column
matching with shuffling, inline
click-to-type blanks that grow with their content, short-answer self-assessment, and the clickable
knowledge-point link), the practice window (question-bank list with per-file data plus search, folder
folding and per-folder selection; practice settings with type/sampling filters and **Shuffle**; and the
one-question-at-a-time round with in-place answer reveal and a final report), the `![[bank#question]]`
embed that renders an answerable card inside another note, the file-explorer menu entry that jumps straight
to a bank's practice settings, and the English/Chinese interface with its language setting. Question-bank
edits trigger a debounced reading-view refresh and invalidate the window's cached parsing.

Not yet implemented: batching of multiple write-backs into one file write, and statistics that span rounds
(a mistake book, charts) beyond what the window computes for a single round.

> The card UI, the insert dialog, write-back, and the practice window have **not** been verified inside a
> real Obsidian instance. The logic layer (parsing, stem preprocessing, grading, write-back, template
> generation, insertion positioning, and session planning) is fully tested, and the window's three pages
> are exercised under jsdom, but DOM behaviour — line rendering between columns, focus handling on blank
> inputs, read-mode re-rendering, how the dialog renders in a real modal, and how the sidebar view lays out
> in a real workspace — can only be confirmed by hand in Obsidian. The README images above are produced by
> the same real rendering code in a headless browser, which narrows that gap but does not close it.

## Contributing

- Keep `main.ts` to plugin lifecycle only; feature logic belongs in its own module under `src/`.
- `parser` / `stem` / `embed` / `plain-text` / `grade` / `writeback` / `hash` / `insert` / `session` must not import `obsidian`, so
  they stay testable under plain Node.
- Never hard-code interface text: add a key to `src/i18n/en.ts`, fill it in `src/i18n/zh.ts` (both tables
  are type-checked against each other), and read it through `t()`. Keep the same `{placeholders}` in both.
- When you change user-visible behaviour, update `README.md`, `README.zh-CN.md`, **and**
  `skills/easyquiz-authoring/SKILL.md` — the latter's examples are executed by `npm test`. If the change is
  visible in the interface, run `npm run assets` so the images stay accurate. If users should hear about it
  after updating, add a What's new entry to both READMEs and `src/whats-new.ts`.
- Run `npm run build`, `npm test`, and `npm run lint` before opening a pull request; CI runs all three.

Supported languages: **English** (this file) and [**中文**](README.zh-CN.md).

## License

0-BSD, see [LICENSE](LICENSE).
