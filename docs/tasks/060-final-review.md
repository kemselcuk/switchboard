# Task 060 — Independent final review

## Purpose

Independently audit the Switchboard delivery against the user's original brief
and the approved plan. This task is a **read-only** review: do not modify files,
commit, or push. Report findings by severity.

## What to read

- `AGENTS.md`
- `docs/PLAN.md`
- `docs/DECISIONS.md`
- `docs/EVIDENCE.md`
- `README.md`
- `src/`, `test/`, `public/`, `examples/`, `scripts/`
- `Dockerfile`, `compose.yaml`, `.dockerignore`
- `package.json`, `.env.example`, `.gitignore`

## Checklist

### Product and contract

- Does it create/update boolean flags?
- Do full on/off and percentage rollouts work?
- Does `POST /api/evaluate` work with `flagKey` + `userId`?
- Does the same user get the same result under the same settings?
- Is the previously included group preserved on a `%20 → %40` move?
- Does an unknown flag return `200 + FLAG_NOT_FOUND`?
- Does a DB failure return `503 + EVALUATION_UNAVAILABLE`; is there any silent
  fail-open?
- Are admin endpoints protected by a Bearer token; are evaluate/health public?
- Do error responses leak a stack trace/token/DB path?

### Algorithm

- Is the SHA-256, first 4 bytes big-endian, bucket 0–99 formula correct?
- Is the `bucket < rolloutPercentage` condition correct?
- Is the immutable `flagKey` assumption consistent in code and documentation?
- Can the golden vectors be verified independently?
- Are the monotonicity and distribution tests deterministic?
- Is there any claim of exact percentages for a small sample?

### Persistence and infrastructure

- Are the SQLite schema, WAL, and volume correct?
- Does `app.close()` close the DB?
- Are settings/results preserved after restart and down/up?
- Is Docker non-root?
- Is `ADMIN_TOKEN` required; is there a hidden default?

### Demo, tests, and documentation

- Does the demo UI embed the token in HTML?
- Does the 20→40 panel really show preserved/newly opened users?
- Does the example client apply the 503 fallback correctly?
- Is `npm test` really green; do the tests really cover the scope?
- Does `npm run smoke` really work?
- Does the README explain integration, the algorithm, tests, and evidence?
- Does the video show the real flow; are duration/format reasonable?
- Are the push history and tag state clean?

### Scope

- Was a custom rule language, segments, A/B analysis, RBAC, audit log, multiple
  environments, SDK, rate limiting, cache, multi-instance, cloud deployment, or
  authorization via flags added?
- Is there unnecessary growth / scope drift?

## Commands

```bash
npm test
npm run smoke
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,codec_name -of default=noprint_wrappers=1 demo/switchboard-demo.mp4
git status --short
git log --oneline -15
git remote -v
```

## Output format

1. **Verdict:** `READY` / `NOT READY`
2. **Blocker:** file/line and reason, if any
3. **Major:** if any
4. **Minor:** if any
5. **Nit:** if any
6. **Evidence:** commands run and a summary of real output
7. **Scope check:** added/drifted work
8. **Recommendation:** what should be done before tagging

Do not modify files, commit/push, or create new files.
