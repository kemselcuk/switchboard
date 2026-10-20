import { spawnSync } from 'node:child_process';

const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-token-change-me';
const PROJECT_KEY = process.env.SWITCHBOARD_PROJECT ?? 'demo';
const ENVIRONMENT_KEY = process.env.SWITCHBOARD_ENV ?? 'production';
const FLAG_KEY = process.env.SWITCHBOARD_FLAG ?? 'new-checkout';
const USER_ID = process.env.SWITCHBOARD_USER ?? 'demo-user-07';

async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${ADMIN_TOKEN}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  return { response, payload };
}

async function ensure(path, body) {
  const { response, payload } = await request(path, { method: 'POST', body });

  if (response.status === 409) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`${path} -> ${response.status} ${JSON.stringify(payload)}`);
  }

  return payload;
}

const project = await ensure('/api/v1/projects', {
  key: PROJECT_KEY,
  name: 'Switchboard demo',
});

await ensure(`/api/v1/projects/${PROJECT_KEY}/environments`, {
  key: ENVIRONMENT_KEY,
  name: 'Production',
});

const flagPath = `/api/v1/projects/${PROJECT_KEY}/environments/${ENVIRONMENT_KEY}/flags`;
const flag = await ensure(flagPath, {
  key: FLAG_KEY,
  description: 'Demo checkout flag',
  enabled: true,
  rolloutPercentage: 40,
});

if (!flag) {
  const { response, payload } = await request(`${flagPath}/${FLAG_KEY}`, {
    method: 'PATCH',
    body: { enabled: true, rolloutPercentage: 40 },
  });

  if (!response.ok) {
    throw new Error(`Could not update flag: ${response.status} ${JSON.stringify(payload)}`);
  }
}

const keyResult = await request(
  `/api/v1/projects/${PROJECT_KEY}/environments/${ENVIRONMENT_KEY}/api-keys`,
  { method: 'POST', body: { name: 'demo key' } },
);

if (!keyResult.response.ok) {
  throw new Error(`Could not create API key: ${keyResult.response.status}`);
}

const apiKey = keyResult.payload.key;
const environment = {
  ...process.env,
  SWITCHBOARD_BASE_URL: BASE_URL,
  SWITCHBOARD_API_KEY: apiKey,
  SWITCHBOARD_FLAG: FLAG_KEY,
  SWITCHBOARD_USER: USER_ID,
};

console.log(`Project: ${PROJECT_KEY}`);
console.log(`Environment: ${ENVIRONMENT_KEY}`);
console.log(`Flag: ${FLAG_KEY} (40%)`);
console.log(`API key prefix: ${keyResult.payload.prefix}`);
console.log('');

for (const service of ['service-a', 'service-b']) {
  const result = spawnSync(
    process.execPath,
    [`examples/${service}/service.mjs`],
    { env: environment, encoding: 'utf8' },
  );

  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }

  process.stdout.write(result.stdout);
}
