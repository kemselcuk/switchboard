import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { initializeV2Database } from '../../src/v2/db.js';
import { createFlagRepository } from '../../src/v2/repositories/flags.js';
import { createProjectRepository } from '../../src/v2/repositories/projects.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

function run(script, args, env) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: '', ...env },
    encoding: 'utf8',
  });
}

test('export/import CLI round-trips a SQLite database', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'switchboard-transfer-cli-'));
  const sourcePath = join(directory, 'source.db');
  const targetPath = join(directory, 'target.db');
  const backupPath = join(directory, 'backup.json');

  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const source = await initializeV2Database({ dbPath: sourcePath });

  try {
    const projects = createProjectRepository(source.db);
    const flags = createFlagRepository(source.db);
    const project = await projects.createProject({
      key: 'cli-demo',
      name: 'CLI demo',
    });
    const environment = await projects.createEnvironment(project.id, {
      key: 'production',
      name: 'Production',
    });

    await flags.createFlagInEnvironment({
      projectId: project.id,
      environmentId: environment.id,
      key: 'cli-flag',
      description: 'Transferred flag',
      enabled: true,
      rolloutBasisPoints: 25000,
    });
  } finally {
    await source.destroy();
  }

  const exported = run('scripts/export-config.mjs', ['--file', backupPath], {
    V2_DB_PATH: sourcePath,
  });

  assert.equal(exported.status, 0, exported.stderr);
  assert.match(exported.stderr, /Exported 2 project\(s\)/);

  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  const cliDemo = backup.projects.find((project) => project.key === 'cli-demo');

  assert.ok(cliDemo);
  assert.equal(cliDemo.environments[0].flags[0].key, 'cli-flag');
  assert.equal(cliDemo.environments[0].flags[0].rolloutPercentage, 25);

  const dryRun = run(
    'scripts/import-config.mjs',
    ['--file', backupPath, '--dry-run'],
    { V2_DB_PATH: targetPath },
  );

  assert.equal(dryRun.status, 0, dryRun.stderr);
  assert.match(dryRun.stdout, /Dry run only/);

  const imported = run(
    'scripts/import-config.mjs',
    ['--file', backupPath],
    { V2_DB_PATH: targetPath },
  );

  assert.equal(imported.status, 0, imported.stderr);
  assert.match(imported.stdout, /"configsCreated": 1/);

  const target = await initializeV2Database({ dbPath: targetPath });

  try {
    const projects = createProjectRepository(target.db);
    const flags = createFlagRepository(target.db);
    const project = await projects.getProjectByKey('cli-demo');
    const environment = await projects.getEnvironment(project.id, 'production');
    const flag = await flags.getFlag(project.id, environment.id, 'cli-flag');

    assert.equal(flag.enabled, true);
    assert.equal(flag.rolloutBasisPoints, 25000);
    assert.equal(flag.description, 'Transferred flag');
  } finally {
    await target.destroy();
  }
});
