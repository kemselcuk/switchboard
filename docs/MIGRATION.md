# Migrating from v1 SQLite to v2 Postgres

The v1 database file is never modified or deleted by the migration. Keep it as
a backup until the v2 service has been verified.

## 1. Prepare Postgres

Start the Compose stack once so Postgres and the v2 schema exist:

```bash
cp .env.example .env
# set ADMIN_TOKEN
docker compose up -d postgres
```

If you use a local Postgres instead, create the database and run:

```bash
DATABASE_URL=postgres://user:password@localhost:5432/switchboard npm run migrate
```

## 2. Run the one-way migration

```bash
DATABASE_URL=postgres://switchboard:switchboard@localhost:5432/switchboard \
SQLITE_PATH=./data/switchboard.db \
npm run migrate:legacy
```

The command:

- reads `flags` from the legacy SQLite file in read-only mode;
- creates missing rows in the seeded `default` project and `production`
  environment;
- preserves key, description, enabled state, rollout percentage, and
  timestamps;
- skips flags that already have a config in that environment;
- is idempotent, so it is safe to run again.

Expected output:

```text
Legacy migration complete: N migrated, 0 skipped, N total.
```

## 3. Verify

Start v2:

```bash
docker compose up --build
```

Check that the legacy routes still return the migrated flags:

```bash
curl -sS http://localhost:3000/api/flags \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

Evaluate a known user and compare the bucket/result with v1. The legacy route
uses the v1 hash and 100 buckets, so the result should be identical.

Create a v2 environment API key and test OFREP:

```bash
curl -sS -X POST http://localhost:3000/api/v1/projects/default/environments/production/api-keys \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"migration check"}'
```

Use the returned `key` with `/ofrep/v1/evaluate/flags/:flag`.

## 4. Rollback

The old SQLite file is untouched. To roll back:

1. Stop the v2 stack.
2. Set `SWITCHBOARD_V2=false` (or unset `DATABASE_URL`).
3. Run `npm start` with the original `DB_PATH`.

No destructive SQLite migration is performed.

## Notes

- The default project/environment is created automatically on first v2 startup.
- `flagKey` remains immutable; a migrated key is the same key used by legacy
  clients.
- New projects use the v2 100,000-bucket algorithm. The default/legacy project
  keeps the v1 100-bucket algorithm.
