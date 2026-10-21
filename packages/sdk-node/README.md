# @switchboard/sdk

Local Node.js/TypeScript client for the Switchboard OFREP API.

This package is part of the Switchboard repository. It is **private and local
only**: it is not published to npm, and the `@switchboard` package name is
provisional for v2.0.

## Build and test

```bash
npm ci
npm run build --workspace @switchboard/sdk
npm test --workspace @switchboard/sdk
```

The package entry point is `dist/index.js` with types in `dist/index.d.ts`, so
build before importing it. `npm run demo:v2` at the repository root builds it
automatically.

## Usage

```js
import { SwitchboardClient } from '@switchboard/sdk';

const client = new SwitchboardClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.SWITCHBOARD_API_KEY,
  timeoutMs: 1000,
});

const details = await client.getBooleanDetails(
  'new-checkout',
  false,
  { targetingKey: 'user-123' },
);

console.log(details.value, details.reason, details.errorCode);
```

`getBooleanValue(key, defaultValue, context)` returns only the boolean.

### Options

| Option | Default | Meaning |
|---|---|---|
| `baseUrl` | required | Switchboard base URL |
| `apiKey` | required | Environment server API key |
| `timeoutMs` | `1000` | Per-attempt request timeout |
| `fetch` | global `fetch` | Custom fetch implementation |
| `bulkEvaluation` | `false` | Use the bulk endpoint and cache the flag set per context |
| `cacheTtlMs` | `10000` | Cache freshness window; `0` forces a refresh on every evaluation |
| `pollingIntervalMs` | `0` | Background refresh interval; `0` disables polling |
| `maxCachedContexts` | `1000` | LRU bound on cached contexts and their timers |
| `maxRetries` | `2` | Extra attempts for network errors and 5xx responses |
| `retryBaseDelayMs` | `100` | Exponential backoff base with jitter |

### Bulk evaluation

Set `bulkEvaluation: true` to use `POST /ofrep/v1/evaluate/flags`. One request
fetches every flag for a context, and later evaluations for that context are
served from the cache:

```js
const client = new SwitchboardClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.SWITCHBOARD_API_KEY,
  bulkEvaluation: true,
});

const context = { targetingKey: 'user-123', plan: 'premium' };
const checkout = await client.getBooleanDetails(
  'new-checkout',
  false,
  context,
);
const search = await client.getBooleanDetails('new-search', false, context);
// Both evaluations share one bulk request.
```

The cache key is the full evaluation context in stable key order, not only
`targetingKey`. Two contexts that differ in any attribute are separate entries.
Contexts must be JSON-serializable plain objects: `Date`, `Map`, `Set`, and
class instances are not supported as cache keys. At most one request is in
flight per context; concurrent evaluations share it.

The cached flag set is fresh for `cacheTtlMs`. A stale entry triggers a
conditional bulk request with `If-None-Match`: `304 Not Modified` refreshes the
entry timestamp and keeps the cached flags, while `200` replaces the entry.
`cacheTtlMs: 0` forces a conditional refresh on every evaluation, but a `304`
can still reuse the last fetched flag set, so it does not disable caching
absolutely.

### Polling

Background polling is opt-in. Set `pollingIntervalMs` to a positive value to
refresh cached contexts in the background (timers are `unref()`ed, so they do
not keep the process alive). Only contexts already in the cache are polled, and
the LRU bound applies to them.

`cacheTtlMs` and `pollingIntervalMs` trade freshness against request volume: a
cached entry is served without a request only while it is younger than
`cacheTtlMs`, and polling lowers the staleness of long-lived, stable contexts
at the cost of periodic requests. Updates are not streamed; short-lived contexts
usually need neither a long TTL nor polling. The cache is process-local, so each
service instance has its own copy.

Call `close()` on shutdown. It clears every polling timer and cached entry; the
OpenFeature provider calls it from `onClose()`. A closed client is not disabled:
later evaluations may repopulate the bounded cache, but polling stays off.

### Failures

Unknown flags, invalid keys, storage unavailability, timeouts, and network
errors return the supplied default with `reason: "ERROR"` and an `errorCode` in
`details`; they do not throw. A missing flag in a bulk response maps to
`FLAG_NOT_FOUND`, and a non-boolean value maps to `TYPE_MISMATCH`.

Retries are bounded by `maxRetries` (`maxRetries + 1` total attempts) with
exponential backoff and jitter, and apply only to network errors, timeouts, and
`5xx` responses. `4xx` responses are never retried. After the final attempt the
client returns the default with the error code; **it does not serve stale cached
values** (there is no stale-if-error policy). A failed background poll leaves
the existing cache entry untouched.

## Behavior

- Uses the single-flag OFREP endpoint by default; `bulkEvaluation: true` uses
  the bulk endpoint and the per-context cache.
- v2.0 supports boolean flags only.
- `targetingKey` defaults to `"anonymous"` when omitted.

See the repository [README](../../README.md) for API keys, project setup, and
the full OFREP contract.
