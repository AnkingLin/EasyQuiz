---
name: easyquiz-authoring
description: Write, edit, and review EasyQuiz question banks (Obsidian plugin, Markdown-native quizzes). Covers how a bank file is detected, the five question types, anchors, blank markers (always in the body, never on the heading line), the git-managed stats/history/rev fields, degrade rules, and the knowledge-point link convention `^[[[]]]` at the end of every stem heading. Use when creating or fixing a quiz bank, adding questions, or explaining the format.
---

# Authoring EasyQuiz question banks

EasyQuiz keeps questions as plain Markdown inside the note. Every answer record is written back into the
same note, so the authoring rules below protect two things at once: the question must be answerable, and
its record must keep pointing at the right question after you edit the file.

## The one hard rule: link the source knowledge point

**End every stem heading with `^[[[]]]`** — `^[`, an Obsidian wikilink to the note (or heading) that the
question was derived from, then `]`. The `[[]]` in the middle is the wikilink and `[]` is where the target
goes; fill it in, as in the example below.

```markdown
## TCP 建立连接需要几次握手？ ^[[[计算机网络/传输层#TCP 三次握手]]]
```

Why the `^[ … ]` wrapper: it marks the link as an annotation attached to the stem rather than part of the
question sentence, and the wikilink inside it stays visible to Obsidian (backlinks, graph, rename updates)
while the plugin keeps the whole thing out of the question text.

Rules that come with it:

- **The link goes at the very end of the heading line**, after the question text. Only a trailing
  `^[[[]]]` is treated as the knowledge link; anything else stays part of the stem. The older two-bracket
  form `^[[…]]` is still recognised, so banks written before this convention keep working.
- **The link is bookkeeping, not question text.** The parser strips it from the displayed title and from
  the derived `id`, and records it separately (`QuizQuestion.knowledgeLink`), so rewording or retargeting
  a link never orphans existing `stats` / `history`. Do not repeat it in the body.
- **It never counts as a "stem changed" edit.** `rev` is computed from the stem body and answer structure,
  not from the heading, so retargeting the knowledge link does not mark records stale.
- **One link per question, no exceptions.** If a question spans two knowledge points, write the more
  specific one in the heading and mention the other in `explanation` as a normal `[[link]]`.
- **Link to something that exists.** An unresolved `^[[[不存在的笔记]]]` costs nothing at parse time but
  produces a dead end in the backlinks panel. Create or check the target note first.
- **Only the heading carries the `^` link.** Inside the stem body write plain `[[]]`; that renders as
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

The **Stem heading matching** setting offers two modes:

- **Fixed level** (default): exactly the headings at the configured level are questions. Best for one
  clean level per file.
- **Auto**: every heading that owns a `quiz` data block is a question, at whatever level it is. This lets
  a file mix an H2 grouping/suggestion heading with H3 questions. A question then runs to the next
  heading that also owns a `quiz` block, of any level; headings in between that own no block stay inside
  the question above as sub-headings.

## The five question types

The `type` field is the **only** thing that decides the type — never infer it from the shape of the text.
Put the `quiz` data block at the end of the question (right after the heading is equivalent).

The stem heading is the question's **name**, not its text. Everything shown to the answerer — the option
list, the matching table, the blank prose, the reference callout — goes on the lines **below** the
heading. Only the heading line is skipped when the body is read, so anything left on it is invisible to
the parser.

| `type` | Stem supplies | Metadata |
|---|---|---|
| `single` | A bullet list; option anchors are optional | `answer: c` (single anchor) |
| `multi` | A bullet list; option anchors are optional | `answer: [a, b]` |
| `match` | A table, 2+ columns; row order *is* the answer | nothing (no `answer`) |
| `blank` | Body prose (below the heading) with `==answer==` markers | optional `blanks:` rules |
| `essay` | Free prose plus a collapsed `> [!question]- 参考答案` callout | nothing |

Anchors use Obsidian's native block-ID syntax `^id` and are optional on choice options. With no option
anchors at all, options are numbered `a`, `b`, `c`… by position; with only some, the unanchored options are
hidden from the card and only the anchored ones can be chosen. Anchors are what bind answer records to
options, so write them when options may be reordered — inserting, deleting, or reordering an anchored
option never misaligns records. Duplicate anchors still make the question unanswerable.

## What the card shows as the stem

The stem is gathered **upward** from the type's **target block**. A block here means a run of consecutive
non-blank lines; a blank line starts a new block.

| `type` | Target block | What the card shows |
|---|---|---|
| `single` / `multi` | The nearest block that contains the option list | The block right above is the stem; non-list lines inside the target block are the supplement, and no ordinary block above is taken then. Tables inside the target stay visible. |
| `match` | The nearest block that contains the table | Only the nearest table becomes the matching structure. Prose above the table is the stem, prose after the table is the supplement; tables above it are ordinary content and stay in the stem. |
| `blank` | The nearest block that contains blank markers | The target block plus any tables/prose reached by the walk is the stem. |
| `essay` | The last block (a reference callout is the last block) | The callout and the blocks above it stay in the shown stem (collapsed), gathered by the same upward walk, so tables above the callout are crossed too and the reference answer is never lost. |

- Walking up, an ordinary blank line stops the stem; a blank line that touches a table is padding and is
  crossed, which is how a table keeps its surrounding prose together.
- Stems render with Obsidian's Markdown rules (tables, quotes, code) into containers that carry
  `markdown-rendered`, so tables use the theme's table styling; blank lines are inserted around tables so the
  card matches the note preview.
- A supplement is rendered directly under the stem, in the same Markdown style.
- Blocks above the stem are not shown at all, so a group heading's intro paragraph (separated by a blank
  line) never leaks into the first question under it.

### `question` and `distractors`

Two optional data-block fields change only how a card looks:

- `question: <text>` replaces the heading text on the card, while the heading still supplies the `id` and
  the knowledge link. Use it when the heading must stay a short name but the question itself needs a full
  sentence (for example a data-heavy multi-part prompt).
- `distractors: <count>` or `distractors: { count: 2, pool: ["TCP", "UDP"] }` adds that many decoy
  options to a `single` / `multi` card. Decoys are never correct answers: `answer` still names only the
  author's anchors, and a decoy ticked by the learner counts as wrong. Options are redrawn after every
  attempt, and a review shows the set used for that answer. If the pool has fewer usable candidates than
  `count`, fewer decoys are added.

Write `question` and `distractors` **only when inserting a single question into an existing note** (for
example with the Insert question command). When generating a whole question bank
file, do not use them unless the user explicitly asks for them: banks are expected to keep the stem in
the heading and to be plain text.

<!-- example:start -->
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
<!-- example:end -->

### Matching questions

Written as a table whose row order *is* the answer; the board is what gets rendered, not the table.

<!-- example:start -->
````markdown
## 将协议与其默认端口配对 ^[[[计算机网络/应用层#常见默认端口]]]

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
- One item can carry several lines in the same neighbouring column pair. Clicking an already-connected
  pair removes that line, so reconnect by removing the old line first.
- **Duplicate cell text within a column is merged**, and one cell is one entry: the text is kept as
  written, so `MySQL / PostgreSQL` is a single item by that name, not two. To make one item answer for
  several, repeat the row — the shared text merges into one node that keeps every line it needs:

  <!-- example:start -->
  ````markdown
  ## 将数据库与其类型配对 ^[[[数据库/关系型数据库#常见数据库分类]]]

  | 数据库 | 类型 |
  | --- | --- |
  | MySQL | 关系型 |
  | PostgreSQL | 关系型 |
  | Redis | 键值型 |

  ```quiz
  type: match
  ```
  ````
  <!-- example:end -->

  `关系型` appears once and carries a line to each of `MySQL` and `PostgreSQL`. Every line must be
  drawn for the question to score, so this is how one-to-many matching is written.
- Every column is shuffled independently, so row order never gives the answer away.
- A `^id` inside a table cell is literal text — matching questions do not use anchors. Records are keyed
  by column index plus row text, so adding or reordering rows keeps records valid.

### Fill in the blank

**Put the blank prose in the body, on the lines below the heading — never in the heading itself.**
The heading is only the question's name: it carries the short title and the trailing knowledge link, and
nothing else. Only the body is scanned for `==answer==` markers, so a heading-as-stem produces zero blanks
and the question degrades with "`type: blank` needs a blank such as `==answer== ^anchor`" even though the
markers are plainly visible in the file. The same rule applies to every type: choice options are body list
items, a matching table is a body table, and blank prose is a body paragraph.

<!-- example:start -->
````markdown
## 慢性肝淤血 ^[[[病理学/局部血液循环障碍#右心衰致肝淤血]]]

慢性肝淤血时肝切面呈红黄相间的"槟榔肝"，暗红色部分对应小叶中央静脉及肝窦的 ==淤血扩张==，
黄色部分对应小叶周边肝细胞的 ==脂肪变性==；长期不愈者可发展为 ==淤血性肝硬化==。

```quiz
id: liver-congestion
type: blank
blanks:
  b1: { accept: ["淤血扩张", "扩张淤血"] }
  b2: { accept: ["脂肪变性", "脂肪变"] }
  b3: { accept: ["淤血性肝硬化"] }
```
````
<!-- example:end -->

The heading above is the short name `慢性肝淤血`; the paragraph below it holds the three blanks. Written
the other way round — the whole sentence with its `==…==` markers on the `##` line — the question cannot
be answered, because there is no body to scan.

- The marker follows the **Blank marker** setting: `==answer==` (default), `**answer**`, or both.
- The blank anchor `^b1` is **optional**; unwritten anchors are numbered `b1`, `b2`, … by position, and
  explicit and automatic anchors can be mixed. Write an anchor only to reference it from `blanks:`.
- Markers inside code blocks and inline code are ignored, so `==like this==` is safe as prose example.
- Rules: `{ accept: [...] }`, `{ ignoreCase: true }`, `{ regex: true }`; unlisted blanks are strict.

<!-- example:start -->
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
<!-- example:end -->

## Multiple choice, short answer, and other shapes

<!-- example:start -->
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
<!-- example:end -->

An `essay` question has no automatic answer. Give a reference answer as a **collapsed callout** so it does
not spoil the question, and grade it by self-assessment:

<!-- example:start -->
````markdown
## 简述 TCP 与 UDP 的主要区别 ^[[[计算机网络/传输层#TCP 与 UDP 对比]]]

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

## Stems, options, explanations and matching cells are Markdown

Everything the author writes is rendered by Obsidian, not escaped:

- the **stem** (the nearest block above the structure, minus the anchor) and its supplement,
- each **option's** text, so `**bold**`, `` `code` ``, `[[links]]` and literal symbols such as `~` or `_` survive,
- the **explanation** shown after grading (and behind **查看解析**),
- each **matching cell**, so `**TCP**` in a table cell is bold on the board.

`![[image.png]]` embeds, `$formula$`, callouts and lists all work in these spots; only the structural parts
(option anchors, blank markers, the matching table itself) are consumed by the plugin. Write `H~2~O` and
the card shows `H~2~O`; the answer anchor still decides grading, so option content never affects what counts
as correct.

Percentage signs, tildes, and underscores are common in real questions (`约 ~5%`, `snake_case`,
`NH_3`). They are safe: only the anchors are stripped from the option text before rendering.
Keep a leading backtick out of a **plain** YAML scalar (`explanation: `x` …` is a YAML error) — quote the
value, or start the text with a normal word.

`shuffle: true` on a question randomises **that question's option order**; the practice window's
**Shuffle** setting does the same for a whole round. Grading is by anchor, so shuffling never changes which
option is correct. Do not write `shuffle` expecting the *question* order to change — question order is
decided in the practice window, not by the field.

## Referencing a question in another note

Any note can render one question as a live, answerable card. Prefer the id form:

```markdown
This week: `tcp-handshake`
```

- The reference must be **exactly one question id as an inline code span**. Ordinary code, fenced code
  blocks and code inside headings are left alone.
- Give referenced questions an explicit `id`. A derived id changes when you rename the heading, and attempt
  records are keyed by the id.
- An id that appears once in the vault resolves directly. Duplicates are ambiguous: a copy in the current
  note wins, otherwise the code is left as written — so keep referenced ids unique.
- Referencing changes nothing about records: answering writes back to the bank note, and the card's
  knowledge-point link still points at the knowledge note.
- Prefer referencing over copying: copies drift, references cannot.

A card rendered from an id reference is also a link: its title and pencil open the bank note at the
question. The plugin **does not intercept `![[...]]` embeds** — images and section embeds keep Obsidian's
native rendering, so do not write embeds expecting a card.

## Fields you must never write by hand

`stats` and `rev` (and `history`) are maintained by the plugin. Writing them yourself corrupts the
statistics or makes the question look edited; `history` carries `at`, `result`, `answer`, `ms`.

Author-writable fields: `type` (required), `id`, `answer`, `blanks`, `shuffle`, `explanation`, `score`,
and — only for inline single-question inserts — `question` and `distractors`.

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
| `blank` with no marker | Structure mismatch — most often because the marked prose sits on the heading line instead of the body |
| Some choice options without anchors | Those options are hidden; the anchored ones stay answerable |
| Duplicate option anchors | Not answerable |
| `answer` pointing at a nonexistent anchor | Not answerable |
| `question` not a non-empty string | Degrade; the heading text is used instead |
| `distractors` has a negative/non-integer `count` or a non-string pool entry | Degrade; the value is ignored |
| `distractors` on `blank` / `match` / `essay` | Warning only; ignored |
| YAML parse error | Degrade; shows the raw error |
| `quiz` block outside any stem heading | File-level warning; not recognised |

A degraded question never exposes a guessed answer.

## Checklist before you hand a bank over

1. Every stem heading ends with `^[[[]]]`, and the target note exists.
2. Every stem heading is a short **name**; the option list, matching table, blank prose, and reference
   callout all live on the lines below it. No `==answer==` marker is left on a heading line. Remember the
   card reads only the nearest block above the structure — keep intro prose and the question in the same
   block when both should show.
3. Choice-option anchors, when present, are unique (or omitted entirely so the options are auto-numbered);
   `answer` names existing anchors.
4. Stable questions have an explicit `id`; no `stats` / `rev` / `history` written by hand.
5. One heading level per file, matching the configured stem heading level — or switch **Heading
   detection** to **Auto** when the file needs mixed heading levels.
6. Do not add `question` or `distractors` when generating a whole bank unless the user asked for them;
   they are for one-off inline inserts.
7. Run **校验当前题库文件** in Obsidian — it reports `共 N 道题：可作答 X，需修正 Y`.
8. Reading view renders each card and submits once, to confirm the block is inside a stem heading.
