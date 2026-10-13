# Skills

Agent-facing instructions for working in this repository.

| Skill | Use it when |
|---|---|
| [`easyquiz-authoring/SKILL.md`](easyquiz-authoring/SKILL.md) | Writing, editing, or reviewing an EasyQuiz question bank: the five question types, anchors, blank markers, the plugin-managed `stats` / `history` / `rev` fields, the degrade rules, and the `^[[[]]]` knowledge-point link convention. |

The examples in `easyquiz-authoring/SKILL.md` are executed by `npm test`
(`tests/quiz-skill-doc.test.ts`): every example marked with `<!-- example:start -->` / `<!-- example:end -->`
is extracted, parsed by the real parser, and graded. Keep the markers when you add or move an example —
without them the example is documentation only, and nothing checks that it still works.
