# Task 090 — Targeting rules and segments (v2.1)

Read `AGENTS.md`, `docs/EXPANSION_PLAN.md` section 18, `docs/DECISIONS.md`
(ADR-006, ADR-016, ADR-029), and the v2 evaluator/repositories first.

## Goal

Let a flag serve its on/off value based on evaluation-context attributes,
without introducing a rule language or an experiment engine. The deterministic
percentage rollout remains the fallback.

## Model

- **Segment** (per project): `key`, `name`, ordered `conditions`.
  - Condition: `{ attribute, operator: "eq", value: string | number | boolean }`.
  - All conditions are ANDed. Max 20 conditions. Attribute name 1..64 chars;
    string value max 256 chars; no objects/arrays/null.
  - Key is unique per project and immutable; segments can be replaced/deleted.
- **Flag rules** (per flag + environment): ordered list, first match wins.
  - Rule: `{ segmentKey }` OR `{ conditions }` (exactly one), plus
    `action: "on" | "off"`. Max 50 rules.
  - Rules may reference only segments in the same project.
- Evaluation precedence:
  1. disabled → `offValue`, `DISABLED`, variant `disabled`;
  2. first matching rule → on/off value, reason `TARGETING_MATCH`, variant
     `on`/`off` (boolean uses the same `on`/`off` variants for rules);
  3. no match → existing `SPLIT` rollout (onValue/offValue).
- Strict equality: no string/number coercion; a missing attribute does not
  match. `targetingKey` is a normal string attribute.
- Rule edits, segment edits, and deletions must change the bulk ETag.

## API (admin token)

- `POST/GET /api/v1/projects/:project/segments`
- `GET/PUT/DELETE /api/v1/projects/:project/segments/:key` (PUT replaces name and
  conditions; key immutable)
- `GET/PUT /api/v1/projects/:project/environments/:env/flags/:key/rules`
  (PUT replaces the ordered list; empty array clears)
- Existing flag delete cascades its rules. Segment delete is rejected while
  referenced by any rule (`409 SEGMENT_IN_USE`).
- Validation errors use the shared envelope and `400 VALIDATION_ERROR`.

## Storage

- Migration: `segments` (project-scoped key/name/conditions/timestamps) and
  `flag_rules` (flag_id, environment_id, position, segment_id nullable,
  conditions text nullable, action, timestamps) with FKs and uniqueness.
- Conditions are JSON text and portable between SQLite and Postgres.
- Export/import includes segments and flag rules; missing fields mean none;
  no version bump (old boolean exports stay valid).

## Tests

- Segment CRUD, duplicate key, immutable key, condition validation, delete when
  referenced (`409`), project isolation.
- Rule replace/order, exactly-one-of segment/conditions, action validation,
  reference to an unknown/foreign segment rejected.
- Evaluation: first match, AND conditions, strict typed equality, missing
  attribute, `TARGETING_MATCH` reason/variant for boolean and non-boolean,
  disabled precedence, rollout fallback, `targetingKey` matching.
- OFREP single/bulk typed results and ETag changes on rule/segment edits.
- Export/import round-trip; Postgres migration/evaluation coverage.
- Legacy API remains boolean-only and unaffected.

## Out of scope

Operators other than `eq` (no `in`, `gt`, regex, OR/NOT), percentage inside a
rule, named variants/weights, segment nesting, UI controls, experiments/A/B,
rule hit analytics, and user accounts.

## Workflow

Small commits; `npm test` per change; `test:contract`, `test:workspaces`,
`test:db`; docs/ADR-030/EVIDENCE. Update this brief's status when done.

## Status

Implemented on `feature/targeting-rules`:

- `27b2dae` — migration `007_targeting_rules.mjs`, segment/rule validation,
  project-scoped segment CRUD and per-environment rules APIs.
- `5269411` — first-match evaluation in the v2 evaluator and OFREP routes,
  `TARGETING_MATCH` results, bulk ETag coverage for rules and segments.
- `2facf9c` — export/import of segments and rules with format version `1`.
- `76b26c6` — SQLite, OFREP contract and Postgres tests.
- `64df1e0` — review fixes: full-context ETag, exactly-one rule shape, body
  limit, database checks, concurrency response, import tests.
- Final docs commit — README, ADR-030, expansion plan, evidence, this status.

Behavior notes: condition lists use 0..20 ANDed `eq` conditions (an empty list
matches every context); rule lists use 0..50 entries and `PUT {"rules":[]}`
clears them. Rules may use a same-project `segmentKey` or inline `conditions`,
never both. `DELETE` of a referenced segment returns `409 SEGMENT_IN_USE`;
deleting a flag cascades its rules. Legacy `/api/flags` and `/api/evaluate`
remain boolean-only and ignore rules. Import is additive; a missing
`segments`/`rules` field means none and leaves existing rules untouched.

Final real output is in `docs/EVIDENCE.md` under "v2.1 targeting rules
(Task 090)":

- `npm test`: 187 tests, 180 pass, 7 Postgres skips.
- `npm run test:contract`: 13/13.
- `npm run test:workspaces`: provider 8/8, SDK 34/34.
- `npm run test:db`: 7/7 on Postgres, including segment/rule storage and
  evaluation, ETag changes, `SEGMENT_IN_USE`, and cascade after flag deletion.

The independent review round found and the branch fixes: the bulk ETag now
covers a canonical fingerprint of the full evaluation context (so different
contexts never share a `304`), segment rules keep only `segmentKey` internally,
the rules `PUT` route accepts a 2 MiB body for the 50×20 maximum, the migration
constrains action/position as well as the rule target, concurrent replacements
return `409 RULE_CONFLICT`, and import documentation now states that present
`rules` arrays replace lists while missing fields leave them untouched.
