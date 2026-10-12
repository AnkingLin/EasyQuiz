---
name: easyquiz-authoring
description: Write, edit, and review EasyQuiz question banks (Obsidian plugin, Markdown-native quizzes). Covers how a bank file is detected, the five question types, anchors, blank markers, the git-managed stats/history/rev fields, degrade rules, and the knowledge-point link convention `^[[知识点]]` at the end of every stem heading. Use when creating or fixing a quiz bank, adding questions, or explaining the format.
---

# Authoring EasyQuiz question banks

EasyQuiz keeps questions as plain Markdown inside the note. Every answer record is written back into the
same note, so the authoring rules below protect two things at once: the question must be answerable, and
its record must keep pointing at the right question after you edit the file.

## The one hard rule: link the source knowledge point

**End every stem heading with `^[[知识点]]`** — the `^` prefix plus an Obsidian wikilink to the note (or
heading) that the question was derived from:

```markdown
## TCP 建立连接需要几次握手？ ^[[计算机网络/传输层#TCP 三次握手]]
```

Why the `^` prefix: it marks the link as an annotation attached to the stem rather than part of the
question sentence, and it keeps the link visible to Obsidian (backlinks, graph, rename updates) while the
plugin keeps it out of the question text.

Rules that come with it:

- **The link goes at the very end of the heading line**, after the question text. Only a trailing
  `^[[…]]` is treated as the knowledge link; anything else stays part of the stem.
- **The link is bookkeeping, not question text.** The parser strips it from the displayed title and from
  the derived `id`, and records it separately (`QuizQuestion.knowledgeLink`), so rewording or retargeting
  a link never orphans existing `stats` / `history`. Do not repeat it in the body.
- **It never counts as a "stem changed" edit.** `rev` is computed from the stem body and answer structure,
  not from the heading, so retargeting the knowledge link does not mark records stale.
- **One link per question, no exceptions.** If a question spans two knowledge points, write the more
  specific one in the heading and mention the other in `explanation` as a normal `[[link]]`.
- **Link to something that exists.** An unresolved `^[[不存在的笔记]]` costs nothing at parse time but
  produces a dead end in the backlinks panel. Create or check the target note first.
- **Only the heading carries the `^` link.** Inside the stem body write plain `[[知识点]]`; that renders as
  an inline link in the stem and is never stripped.

If a bank has no knowledge notes yet, still write the link — the knowledge note is the unit that makes the
bank reviewable and searchable later.

## Bank file detection

A note is a question bank when **any** of these holds (frontmatter is preferred, it keeps the body clean):

1. frontmatter `quiz: true`;
2. a `#quiz` tag, in frontmatter tags or inline;
3. a configured path glob matches (default: none).

```markdown
---
quiz: true
schemaVersion: 1
title: 计算机网络 · 第三章
tags:
  - quiz/net
---
```

The body starts at the first heading that matches the configured **stem heading level** (default H2, one
level per file). A question runs from its stem heading to the next heading of the same or higher level.
A deeper heading is absorbed as a sub-heading **only if** a shallower heading appears later in the file.

## The five question types

The `type` field is the **only** thing that decides the type — never infer it from the shape of the text.
Put the `quiz` data block at the end of the question (right after the heading is equivalent).

| `type` | Stem supplies | Metadata |
|---|---|---|
| `single` | A bullet list, one `^anchor` per option | `answer: c` (single anchor) |
| `multi` | A bullet list, one `^anchor` per option | `answer: [a, b]` |
| `match` | A table, 2+ columns; row order *is* the answer | nothing (no `answer`) |
| `blank` | Prose with `==answer==` markers | optional `blanks:` rules |
| `essay` | Free prose plus a collapsed `> [!question]- 参考答案` callout | nothing |

Anchors use Obsidian's native block-ID syntax `^id` and are **required** on every choice option. Anchors
are what bind answer records to options, so inserting, deleting, or reordering options never misaligns
records — but a missing or duplicated anchor makes the question unanswerable.

<!-- example:start -->
````markdown
## TCP 建立连接需要几次握手？ ^[[计算机网络/传输层#TCP 三次握手]]

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
<!-- example:end -->

### Matching questions

Written as a table whose row order *is* the answer; the board is what gets rendered, not the table.

<!-- example:start -->
````markdown
## 将协议与其默认端口配对 ^[[计算机网络/应用层#常见默认端口]]

| 协议 | 端口 |
| --- | --- |
| HTTP | 80 |
| HTTPS | 443 |
| SSH | 22 |

```quiz
id: protocol-ports
type: match
```
````
<!-- example:end -->

- Only **adjacent columns** connect: `A | B | C` yields `A–B` and `B–C`, never `A–C`.
- Direction does not matter (left-then-right scores the same as right-then-left).
- One item links at most once per neighbouring column pair; reconnecting replaces the old line.
- Duplicate cell text within a column is merged; separate multiple entries in one cell with ` / `.
- Every column is shuffled independently, so row order never gives the answer away.
- A `^id` inside a table cell is literal text — matching questions do not use anchors. Records are keyed
  by column index plus row text, so adding or reordering rows keeps records valid.

### Fill in the blank

- The marker follows the **Blank marker** setting: `==answer==` (default), `**answer**`, or both.
- The blank anchor `^b1` is **optional**; unwritten anchors are numbered `b1`, `b2`, … by position, and
  explicit and automatic anchors can be mixed. Write an anchor only to reference it from `blanks:`.
- Markers inside code blocks and inline code are ignored, so `==like this==` is safe as prose example.
- Rules: `{ accept: [...] }`, `{ ignoreCase: true }`, `{ regex: true }`; unlisted blanks are strict.

<!-- example:start -->
````markdown
## 补全 TCP 首部字段 ^[[计算机网络/传输层#TCP 首部]]

TCP 首部的最小长度是 ==20== 字节，其中 ==序号== 字段用于标识本报文段的数据的第一个字节。

```quiz
type: blank
blanks:
  b1: { accept: ["20", "20字节", "二十"] }
  b2: { ignoreCase: true }
```
````
<!-- example:end -->

## Multiple choice, short answer, and other shapes

<!-- example:start -->
````markdown
## 下列哪些属于传输层协议？ ^[[计算机网络/传输层#传输层协议]]

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
<!-- example:end -->

An `essay` question has no automatic answer. Give a reference answer as a **collapsed callout** so it does
not spoil the question, and grade it by self-assessment:

<!-- example:start -->
````markdown
## 简述 TCP 与 UDP 的主要区别 ^[[计算机网络/传输层#TCP 与 UDP 对比]]

从连接、可靠性、传输方式与适用场景四个方面作答。

> [!question]- 参考答案
> TCP 面向连接、可靠、字节流；UDP 无连接、不保证可靠、报文边界保留。

```quiz
id: tcp-vs-udp
type: essay
```
````
<!-- example:end -->

Always give `essay` questions an explicit `id`: they are the type most often reworded, and self-assessed
records are the ones you least want to lose.

## Fields you must never write by hand

`stats` and `rev` (and `history`) are maintained by the plugin. Writing them yourself corrupts the
statistics or makes the question look edited; `history` carries `at`, `result`, `answer`, `ms`.

Author-writable fields: `type` (required), `id`, `answer`, `blanks`, `shuffle`, `explanation`, `score`.

**Write `id` whenever the question may be reworded.** Without it the id is derived from the stem heading
text, so renaming the heading orphans the accumulated records. Give every question that matters a short
stable id such as `tcp-handshake`. The knowledge link is already excluded from the derived id, but the
rest of the heading is not.

## Degrade rules: one bad question never breaks the bank

The type is never inferred. A question degrades to a plain code block with a highlighted explanation
(leaving every other question intact) when:

| Situation | Behaviour |
|---|---|
| `type` missing | Degrade; `type` is required |
| `type` invalid | Degrade; lists the five valid values |
| `single` / `multi` with no list | Structure mismatch |
| `match` with no table or fewer than 2 columns | Structure mismatch |
| `blank` with no marker | Structure mismatch |
| Option missing an anchor, or duplicate anchors | Not answerable |
| `answer` pointing at a nonexistent anchor | Not answerable |
| YAML parse error | Degrade; shows the raw error |
| `quiz` block outside any stem heading | File-level warning; not recognised |

A degraded question never exposes a guessed answer.

## Checklist before you hand a bank over

1. Every stem heading ends with `^[[知识点]]`, and the target note exists.
2. Every choice option has a unique `^anchor`; `answer` names existing anchors.
3. Stable questions have an explicit `id`; no `stats` / `rev` / `history` written by hand.
4. One heading level per file, matching the configured stem heading level.
5. Run **校验当前题库文件** in Obsidian — it reports `共 N 道题：可作答 X，需修正 Y`.
6. Reading view renders each card and submits once, to confirm the block is inside a stem heading.
