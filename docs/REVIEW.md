# Independent Final Review and Closure

## Verdict

First independent review: **NOT READY** (no blockers; the final EVIDENCE TODOs
and a few minor findings were present).

After fixes: **READY** — all blocker/major findings were closed; tests and the
Docker smoke test were re-run.

## Review scope

The independent reviewer (DeepSeek V4.1 Flash `max`, fresh context) verified the
following by running it directly:

- `npm test` (two consecutive runs)
- `npm run smoke`
- Video metadata via `ffprobe`
- `git status`, `git log`, `git remote`, `git tag`
- Golden vectors, 10,000 fixed IDs distribution, and subset check
- Live API: auth, create, evaluate, unknown flag, validation
- Demo UI token behavior and the 20→40 panel
- Example client 503/exit-code behavior
- Docker non-root and volume persistence
- Out-of-scope feature check

The reviewer worked read-only; did not modify files, commit, or push.

## Findings and closure

| ID | Finding | Status |
|---|---|---|
| M1 | `docs/EVIDENCE.md` contained TODOs | Closed: commit, git log, remote, and tag information added |
| m1 | Video was 46 s; the plan called for 1–2 min | Closed: video re-recorded at 62.68 s |
| m2 | README/ADR did not state the system `ffmpeg` requirement for MP4 conversion | Closed: README and ADR-012 updated |
| m3 | A closed DB connection returned 500 on evaluate | Closed: repository read error wrapped as 503; test added |
| n1 | `package.json` version was `0.1.0`, tag `v1.0.0` | Closed: version set to `1.0.0` |
| n2 | Video hardcoded the test count as `57/57` | Closed: parsed from test output |
| n3 | Demo ID range in the Task 040 brief did not match the code | Closed: updated to "12 selected IDs" |

## Final verification

```text
npm test
ℹ tests 58
ℹ pass 58
ℹ fail 0
```

```text
npm run smoke
Smoke test passed: flag and evaluation survived restart and down/up.
```

```text
ffprobe
codec_name=h264
width=1280
height=720
duration=62.680000
size=580067
```

- `main` and `origin/main` are the same.
- The `v1.0.0` tag points to the release commit.
- The Docker image runs as the non-root `node` user.
- `.env` is not tracked in the repo; the smoke test does not use the real token.

## Scope check

No custom rule language, segments, A/B analysis, RBAC, audit log, multiple
environments, SDK, rate limiting, cache, multi-instance, cloud deployment, or
authorization via flags was added. `playwright-core` is a devDependency only and
does not enter the production image.
