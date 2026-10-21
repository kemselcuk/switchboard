# Task 088 — Flag types (server core)

v2.1 expansion, phase 1. Read `AGENTS.md`, `docs/EXPANSION_PLAN.md` section 17,
and the current v2 flag/evaluator/OFREP code first.

## Model

Flag types: `boolean` (existing), `string`, `number`, `json` (plain JSON object).
The type is immutable after creation (like the key). Percentage rollout keeps the
existing deterministic bucket.

Each `flag_configs` row stores optional `on_value` / `off_value` JSON text:

- boolean: no values; included → `true`, excluded/disabled → `false`.
- string/number/json: require both `onValue` and `offValue`.
  - enabled and bucket included → `onValue`, reason `SPLIT`, variant `on`;
  - enabled and excluded → `offValue`, reason `SPLIT`, variant `off`;
  - disabled → `offValue`, reason `DISABLED`, variant `disabled`.

Value limits: string ≤ 4096 characters; number finite; JSON plain object,
serialized ≤ 8192 bytes. Arrays/null are not `json` values.

## API

`POST /api/v1/projects/:project/environments/:env/flags` accepts:
`{ key, type?, description?, enabled?, rolloutPercentage?, onValue?, offValue? }`
with `type` defaulting to `boolean`.

`PATCH .../flags/:key` accepts description/enabled/rolloutPercentage/onValue/
offValue; `type` is not patchable.

Validation: boolean rejects on/off values; non-boolean requires both; the
envelope is `400 VALIDATION_ERROR`. Creating an existing key with a different
type returns `409 FLAG_TYPE_MISMATCH`. Responses include `type` and, for
non-boolean flags, `onValue`/`offValue`.

OFREP returns the typed `value` (string/number/object/boolean) with the reasons
above. The bulk ETag input must include type and both values.

Legacy `/api/flags` and `/api/evaluate` stay boolean-only: list/get/update
ignore non-boolean flags (404 for a non-boolean key), and legacy create always
creates a boolean flag.

## Files

- `db/migrations/006_flag_values.mjs`
- `src/v2/evaluator.js` (generic `evaluateFlag`; update callers/tests)
- `src/v2/repositories/common.js` (`mapFlag` parses values)
- `src/v2/repositories/flags.js`
- `src/v2/routes/management.js`
- `src/v2/routes/ofrep.js` (ETag includes type/values)
- `src/v2/schemas.js`
- `src/v2/legacy-repository.js`
- `src/v2/repositories/transfer.js` (export/import values, validation)
- `test/v2/flag-types.test.js` (new)
- `test/v2/ofrep.test.js`, `test/contract/ofrep.test.js`,
  `test/v2/transfer.test.js`, `test/v2/flags.test.js` as needed

## Tests

- Create/read/update string, number, and JSON flags; values in management
  responses; boolean unchanged.
- Deterministic evaluation: rollout 100 → onValue, 0 → offValue, disabled →
  offValue; reasons/variants; boolean regression.
- Validation: missing on/off, boolean with values, JSON array/null, oversized
  string/JSON, type immutability, type mismatch on create.
- OFREP single/bulk typed values; contract schema validation for string/number/
  object; ETag changes when onValue changes.
- Legacy list/get ignore non-boolean flags.
- Export/import round-trips types and values; invalid combinations rejected.
- `npm test`, `npm run test:contract`, `npm run test:db` green.

## Out of scope

Targeting rules, variants/weights, UI controls, per-type legacy support,
string/number SDK methods (Task 089), and flag type changes after creation.

## Workflow

Implement server core first; SDK/provider in Task 089 after this lands; docs and
review afterwards.

## Status

Landed on `main` in `793f4cc` (`feat: add flag value types`). Final suite
counts after the Task 089 follow-up and review fixes (`52a9422`, `0e5f6be`):

```text
npm test
ℹ tests 158
ℹ pass 152
ℹ fail 0
ℹ skipped 6

npm run test:contract
ℹ tests 12
ℹ pass 12
ℹ fail 0
```

The 6 skipped tests are the Postgres integration tests (`DATABASE_URL` unset);
the Postgres run includes typed string/JSON evaluation (6/6 with the flag
deletion test).
Task 089 then added typed SDK/provider coverage; see the Task 089 status.
