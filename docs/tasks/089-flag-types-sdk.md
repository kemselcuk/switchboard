# Task 089 — Flag types (SDK and provider)

Phase 2 of the v2.1 flag types track. Server support for
`boolean/string/number/json` with `onValue`/`offValue` landed in Task 088.
Read `AGENTS.md`, `docs/tasks/088-flag-types-server.md`, the SDK/provider
sources, and `docs/DECISIONS.md` first.

## SDK

Add typed evaluation methods while keeping the existing boolean API:

- `getStringDetails(flagKey, defaultValue, context)`
- `getNumberDetails(flagKey, defaultValue, context)`
- `getObjectDetails(flagKey, defaultValue, context)`
- matching `getStringValue`, `getNumberValue`, `getObjectValue`

Types: export a generic `EvaluationDetails<T>`; keep
`BooleanEvaluationDetails` as an alias. Object values are non-null objects
(plain objects from the server's `json` type; accept arrays defensively).
Number values must be finite.

Behavior:

- Single-flag and bulk cache paths both validate the expected type. A wrong
  value returns the supplied default with reason `ERROR` and
  `errorCode: 'TYPE_MISMATCH'`; error codes/messages stay consistent with the
  boolean path.
- Missing flags, auth, storage, timeout, network, and retry behavior are
  unchanged.
- The bulk cache stores untyped values; typing happens at read time.

## Provider

Implement `resolveStringEvaluation`, `resolveNumberEvaluation`, and
`resolveObjectEvaluation` through the SDK typed getters instead of returning
`TYPE_MISMATCH`. Map SDK error codes to OpenFeature `ErrorCode` (including
`TYPE_MISMATCH`, `FLAG_NOT_FOUND`, `GENERAL`). Boolean behavior and bulk/cache
defaults stay unchanged.

## Files

- `packages/sdk-node/src/index.ts`
- `packages/sdk-node/test/sdk.test.ts`
- `packages/openfeature-provider/src/index.ts`
- `packages/openfeature-provider/test/provider.test.ts`
- `test/contract/ofrep-provider.test.js` (one typed official-provider check)
- `packages/sdk-node/README.md`, `packages/openfeature-provider/README.md`,
  `README.md`, `docs/DECISIONS.md` (ADR-029), `docs/EVIDENCE.md`,
  `docs/tasks/088-flag-types-server.md`, `docs/tasks/089-flag-types-sdk.md`,
  `docs/EXPANSION_PLAN.md`

## Tests

- SDK: string/number/object single and bulk values; wrong-type fallback with
  TYPE_MISMATCH; number finite; object; boolean regression; existing cache,
  ETag, retry, timeout, close tests stay green.
- Provider: string/number/object resolution, wrong type mapping, boolean
  regression, bulk-by-default path.
- Official OFREP provider test evaluates a string (and/or number) flag.
- `npm run test:workspaces`, `npm test`, `npm run test:contract` green.

## Out of scope

Targeting rules, variants/weights, UI controls, legacy non-boolean support,
and changing a flag's type after creation.

## Workflow

SDK/provider first; docs; independent review round.

## Status

Landed on `main` in `52a9422` (`feat: add typed flag support to sdk and
provider`). Recorded output is in
`docs/EVIDENCE.md` under "v2.1 flag types (Tasks 088 + 089)":

- SDK tests `33/33`, provider tests `8/8`; both packages build with `tsc`.
- `npm run test:workspaces` green.
- Root `npm test`: 156 tests, 151 pass, 5 Postgres skips.
- `npm run test:contract`: 12/12, including the extended official-provider
  string and number evaluation.
