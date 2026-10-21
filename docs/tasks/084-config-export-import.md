# Task 084 — Configuration export/import

Follow-up to the performance/portability research (F1). Read `AGENTS.md`,
`docs/EXPANSION_PLAN.md` section 13, and the v2 repositories first.

## Goal

Move project/environment/flag/config definitions between Switchboard instances
(backup, CI seed, staging → production copy) as JSON. API keys and any secret
material are never exported. This stays a small, dependency-free CLI + core
module; no new HTTP endpoints.

## Format (version 1)

```json
{
  "format": "switchboard-v2-export",
  "version": 1,
  "exportedAt": "2026-10-21T...",
  "projects": [
    {
      "key": "demo",
      "name": "Demo",
      "environments": [
        {
          "key": "production",
          "name": "Production",
          "flags": [
            {
              "key": "new-checkout",
              "type": "boolean",
              "description": "New checkout",
              "enabled": true,
              "rolloutPercentage": 40,
              "createdAt": "...",
              "updatedAt": "..."
            }
          ]
        }
      ]
    }
  ]
}
```

- Flags are emitted per environment only when a config exists there.
- IDs (UUIDs, legacy IDs) are not exported; keys are the identity.
- No `api_keys`, secret, hash, prefix, or token fields. A test must assert this.

## Behavior

- Export: read all projects, environments, flags, and configs in a stable order;
  emit the format above.
- Import: validate `format` and `version`; apply inside one transaction:
  - create missing projects/environments (existing names untouched),
  - create missing flags, update the description of existing flags,
  - create or update the config (`enabled`, `rolloutPercentage`) per environment,
  - never delete or rename anything, never touch API keys.
- Idempotent: importing the same file twice yields the same state; a changed
  export updates existing configs.
- `dryRun` validates and counts changes without writing.
- Reject unknown formats/versions, non-boolean flag types, and invalid keys or
  rollout values with a clear error (no partial writes).

## CLI

- `npm run export:config -- --file backup.json` (stdout when `--file` is omitted)
- `npm run import:config -- --file backup.json` (optionally `--dry-run`)
- Uses `DATABASE_URL` when set, otherwise `V2_DB_PATH` (default
  `./data/switchboard-v2.db`), matching `src/server.js`.
- Never prints secrets; export contains none.

## Files

- `src/v2/repositories/transfer.js` (core; Kysely queries live here)
- `scripts/export-config.mjs`
- `scripts/import-config.mjs`
- `test/v2/transfer.test.js`
- `package.json` (two scripts)

## Out of scope

API keys/secrets, deletion, renaming keys, targeting rules, flag types other
than boolean, HTTP endpoints, scheduled backups, and cross-version migration.

## Acceptance criteria

- Export includes projects/environments/flags/configs and no API-key/secret
  fields (asserted, not only by inspection).
- Round-trip into a fresh v2 database preserves keys, names, descriptions,
  enabled state, and rollout percentages; evaluations match.
- Re-import is idempotent; a changed export updates configs.
- Dry run performs no writes.
- Invalid format/version/type/key/rollout is rejected without partial writes.
- Import leaves existing API keys intact.
- `npm test` is green; `npm run test:workspaces` is unaffected.
- README/package docs, ADR-025, EVIDENCE and this task status are updated.

## Workflow

Core module + tests first; CLI after the core lands; docs and an independent
review round at the end.
