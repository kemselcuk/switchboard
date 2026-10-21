# Task 083 — SDK bulk evaluation, ETag, polling and retries

Follow-up to task 082 (P4/P7 in the performance research). Read `AGENTS.md`,
`docs/EXPANSION_PLAN.md` section 11, and the SDK/provider sources first.

## Goal

Make the Node SDK use the OFREP bulk endpoint with conditional requests
(`ETag` / `If-None-Match` / `304`), a per-context cache, optional background
polling, and bounded transport retries. The server already supports bulk,
quoted ETags and 304 (task 082 / v2.0). Keep the single-flag endpoint as the
default for direct SDK users; the OpenFeature provider enables bulk.

## API contract (SDK)

Extend `SwitchboardClientOptions`:

| Option | Default | Meaning |
|---|---|---|
| `bulkEvaluation` | `false` | Use `POST /ofrep/v1/evaluate/flags` and cache per context |
| `pollingIntervalMs` | `30000` | Cache freshness window and background refresh interval; `0` disables both |
| `maxRetries` | `2` | Extra attempts for network errors and 5xx responses (total `maxRetries + 1`); 4xx are not retried |
| `retryBaseDelayMs` | `100` | Exponential backoff base with jitter; tests set `0` |

Add `close(): void` to `SwitchboardClient`. It clears every polling timer
(timers must be `unref()`ed so they never keep the process alive).

Bulk behavior:

- Cache key is the full evaluation context (stable key order), not only
  `targetingKey`.
- One in-flight bulk request per context; concurrent evaluations share it.
- First evaluation performs the bulk request, stores all flags and the `ETag`.
- While the cache is fresh (`pollingIntervalMs`), evaluations are served from
  it with no HTTP request.
- A stale cache triggers a conditional request with `If-None-Match`. `304`
  refreshes the cache timestamp and serves the cached flags; `200` replaces
  the cache.
- A missing flag in a successful bulk response returns the default with
  `reason: 'ERROR'` and `errorCode: 'FLAG_NOT_FOUND'`.
- A non-boolean flag value returns `TYPE_MISMATCH`.
- On final failure (after retries) the client returns the default with the
  existing error codes; it does not serve stale values. Background polling
  failures leave the previous cache untouched.
- Single-flag mode (`bulkEvaluation: false`) keeps today's behavior, with the
  new bounded retries applied.

## Provider

`SwitchboardProvider` enables `bulkEvaluation: true` by default (callers can
override with `bulkEvaluation: false`). Implement `onClose()` to call
`client.close()`. Provider tests must prove that evaluating two flags for the
same context results in one bulk HTTP request and that unknown flags still map
to `FLAG_NOT_FOUND`.

## Out of scope

Targeting rules, new flag types, browser SDK, metrics, management OpenAPI,
persistent client cache, stale-if-error policies, and server changes.

## Acceptance criteria

- SDK unit tests cover: one bulk request for two flags, ETag round-trip and
  304 reuse, cache freshness, negative/non-boolean flags, retry on 5xx, no
  retry on 401, timeout regression, and `close()` stopping polling.
- Provider tests cover bulk-by-default and `onClose`.
- `npm run test:workspaces` and `npm test` are green; `npm run test:contract`
  stays green.
- README/package READMEs document the new options, the polling/staleness
  trade-off, and that the SDK/provider are still local/private packages.
- ADR-024 records the client cache/ETag/polling decision (process-local cache,
  no stale-if-error, provider default).

## Workflow

Sequential: SDK core first; provider + docs after the SDK lands; independent
review round at the end.
