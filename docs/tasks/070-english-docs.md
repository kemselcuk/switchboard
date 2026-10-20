# Task 070 — Translate project documentation to English

## Goal

Translate all remaining project Markdown documentation into clear, professional
technical English. This is a documentation-only task: do not change code, UI
text, scripts, tests, package metadata, GitHub settings, or the LICENSE file.

## Files to translate

- `AGENTS.md`
- `docs/PLAN.md`
- `docs/DECISIONS.md`
- `docs/EVIDENCE.md`
- `docs/REVIEW.md`
- `docs/tasks/README.md`
- `docs/tasks/010-storage-core.md`
- `docs/tasks/020-admin-api.md`
- `docs/tasks/030-evaluation.md`
- `docs/tasks/040-demo-client.md`
- `docs/tasks/050-docker.md`
- `docs/tasks/060-final-review.md`

`README.md` is already English. `docs/tasks/070-english-docs.md` is already
English and must not be changed by this task.

## Translation rules

- Use concise, natural technical English; avoid literal word-for-word phrasing.
- Preserve technical meaning, scope, warnings, and acceptance criteria.
- Preserve all code blocks, commands, JSON, file paths, URLs, numbers, commit
  hashes, tag names, and literal terminal output exactly.
- Do not translate text inside fenced code blocks in `docs/EVIDENCE.md`; those
  are real transcripts. Translate only the surrounding prose. Add a short note
  that some transcript labels are Turkish because the demo UI is Turkish.
- Keep Markdown structure, tables, headings, links, and emphasis.
- Use consistent terms: feature flag, flag, rollout, bucket, evaluation,
  admin, storage, smoke test, evidence, acceptance criteria.
- Do not add new claims, features, or results.
- Do not remove limitations or security warnings.

## Acceptance

- No Turkish prose remains outside literal code blocks in the listed files.
- Code blocks and real outputs are unchanged.
- `git diff --name-only` contains only the listed documentation files.
- `npm test` still passes.
- Commit with message: `docs: translate documentation to English`.
- Do not push; the orchestrator will review and push.

## Report

1. Commit SHA
2. Changed files
3. `npm test` summary
4. Any Turkish prose intentionally left (with reason)
5. `git status --short`
