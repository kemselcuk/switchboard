import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const directory = mkdtempSync(join(tmpdir(), 'switchboard-packages-'));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`,
    );
  }

  return result;
}

function tarballFiles(tarball) {
  return run('tar', ['-tzf', tarball]).stdout
    .trim()
    .split('\n')
    .filter(Boolean);
}

try {
  run('npm', ['run', 'build']);

  const pack = run('npm', [
    'pack',
    '--workspace',
    '@switchboard/sdk',
    '--workspace',
    '@switchboard/openfeature-provider',
    '--pack-destination',
    directory,
  ]);
  const tarballs = readdirSync(directory)
    .filter((name) => name.endsWith('.tgz'))
    .map((name) => join(directory, name))
    .sort();

  if (tarballs.length !== 2) {
    throw new Error(`Expected 2 tarballs, found ${tarballs.length}`);
  }

  for (const tarball of tarballs) {
    const files = tarballFiles(tarball);
    const required = [
      'package/dist/index.js',
      'package/dist/index.d.ts',
      'package/README.md',
      'package/LICENSE',
    ];

    for (const file of required) {
      if (!files.includes(file)) {
        throw new Error(`${tarball} is missing ${file}`);
      }
    }

    if (files.some((file) => file.startsWith('package/src/') || file.startsWith('package/test/'))) {
      throw new Error(`${tarball} contains source or test files`);
    }
  }

  const consumer = join(directory, 'consumer');

  mkdirSync(consumer, { recursive: true });
  writeFileSync(
    join(consumer, 'package.json'),
    `${JSON.stringify({ private: true, type: 'module' }, null, 2)}\n`,
  );

  run('npm', [
    'install',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',
    ...tarballs,
  ], { cwd: consumer });

  writeFileSync(join(consumer, 'verify.mjs'), `import http from 'node:http';
import { once } from 'node:events';
import { SwitchboardClient } from '@switchboard/sdk';
import { SwitchboardProvider } from '@switchboard/openfeature-provider';
import { OpenFeature } from '@openfeature/server-sdk';

const server = http.createServer((request, response) => {
  let body = '';

  request.on('data', (chunk) => {
    body += chunk;
  });
  request.on('end', () => {
    const payload = body ? JSON.parse(body) : {};
    const isBulk = request.url === '/ofrep/v1/evaluate/flags';

    response.writeHead(200, {
      'content-type': 'application/json',
      etag: '"package-check"',
    });

    if (isBulk) {
      response.end(JSON.stringify({
        flags: [{
          key: 'new-checkout',
          value: true,
          reason: 'SPLIT',
          variant: 'enabled',
        }],
        metadata: { version: 'package-check' },
      }));
      return;
    }

    if (payload.context?.targetingKey !== 'package-user') {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: 'missing targetingKey' }));
      return;
    }

    response.end(JSON.stringify({
      key: 'new-checkout',
      value: true,
      reason: 'SPLIT',
      variant: 'enabled',
    }));
  });
});

server.listen(0, '127.0.0.1');
await once(server, 'listening');
const { port } = server.address();
const baseUrl = 'http://127.0.0.1:' + port;
const apiKey = 'sb_srv_package_check';

const client = new SwitchboardClient({ baseUrl, apiKey });
const direct = await client.getBooleanDetails(
  'new-checkout',
  false,
  { targetingKey: 'package-user' },
);

const provider = new SwitchboardProvider({ baseUrl, apiKey });
await OpenFeature.setProviderAndWait(provider);
const viaProvider = await OpenFeature
  .getClient()
  .getBooleanDetails('new-checkout', false, { targetingKey: 'package-user' });

await OpenFeature.clearProviders();
await provider.onClose();
client.close();
server.close();

if (direct.value !== true || viaProvider.value !== true) {
  console.error(JSON.stringify({ direct, viaProvider }));
  process.exit(1);
}

console.log(JSON.stringify({
  sdk: direct.value,
  provider: viaProvider.value,
  reason: viaProvider.reason,
}));
`);

  const verify = run(process.execPath, ['verify.mjs'], { cwd: consumer });

  for (const tarball of tarballs) {
    const size = statSync(tarball).size;

    console.log(
      `Tarball: ${tarball.split('/').pop()} (${(size / 1024).toFixed(1)} KiB)`,
    );
  }

  const installed = ['@switchboard/sdk', '@switchboard/openfeature-provider']
    .map((name) => {
      const pkg = JSON.parse(readFileSync(
        join(consumer, 'node_modules', name, 'package.json'),
        'utf8',
      ));

      return `${pkg.name}@${pkg.version}`;
    });

  console.log(`Installed packages: ${installed.join(', ')}`);
  console.log(`Verification: ${verify.stdout.trim()}`);
  console.log('Package install check passed.');
} finally {
  rmSync(directory, { recursive: true, force: true });
}
