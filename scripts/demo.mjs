const ADMIN_TOKEN = process.env.ADMIN_TOKEN ?? 'dev-token-change-me';
const BASE_URL = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(
  /\/+$/,
  '',
);
const FLAG_KEY = 'demo-checkout';
const FLAG_DESCRIPTION = 'Demo: 20 → 40 rollout karşılaştırması';
// Buckets for demo-checkout: 4,48,70,67,93,17,37,28,15,21,3,35.
// 4 open at 20%, 4 newly open at 40%, 4 stay closed.
const DEMO_USERS = [
  'demo-user-01',
  'demo-user-02',
  'demo-user-04',
  'demo-user-05',
  'demo-user-06',
  'demo-user-09',
  'demo-user-14',
  'demo-user-17',
  'demo-user-19',
  'demo-user-21',
  'demo-user-25',
  'demo-user-33',
];

async function api(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { accept: 'application/json' };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (auth) {
    headers.authorization = `Bearer ${ADMIN_TOKEN}`;
  }

  let response;

  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new Error(`${BASE_URL} adresine ulaşılamadı: ${error.message}`);
  }

  const raw = await response.text();
  let payload = null;

  if (raw) {
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const code = payload?.error?.code ?? `HTTP_${response.status}`;
    const message = payload?.error?.message ?? response.statusText;
    const error = new Error(
      `${method} ${path} → HTTP ${response.status} ${code}: ${message}`,
    );

    error.status = response.status;
    error.code = code;
    throw error;
  }

  return payload;
}

async function ensureFlag() {
  try {
    return await api('/api/flags', {
      method: 'POST',
      body: {
        key: FLAG_KEY,
        description: FLAG_DESCRIPTION,
        enabled: true,
        rolloutPercentage: 20,
      },
    });
  } catch (error) {
    if (error.status !== 409) {
      throw error;
    }

    return api(`/api/flags/${FLAG_KEY}`, {
      method: 'PATCH',
      body: {
        description: FLAG_DESCRIPTION,
        enabled: true,
        rolloutPercentage: 20,
      },
    });
  }
}

function setRollout(rolloutPercentage) {
  return api(`/api/flags/${FLAG_KEY}`, {
    method: 'PATCH',
    body: { rolloutPercentage },
  });
}

function evaluate(userId) {
  return api('/api/evaluate', {
    method: 'POST',
    auth: false,
    body: { flagKey: FLAG_KEY, userId },
  });
}

function outcome(first, second) {
  if (first.enabled) {
    return 'korundu';
  }
  if (second.enabled) {
    return 'yeni açıldı';
  }
  return 'kapalı';
}

function formatTable(at20, at40) {
  const headers = ['USER', 'BUCKET', '%20', '%40', 'DURUM'];
  const rows = at20.map((first, index) => {
    const second = at40[index];

    return [
      first.userId,
      String(first.bucket),
      first.enabled ? 'açık' : 'kapalı',
      second.enabled ? 'açık' : 'kapalı',
      outcome(first, second),
    ];
  });
  const widths = headers.map((header, column) => Math.max(
    header.length,
    ...rows.map((row) => row[column].length),
  ));
  const formatRow = (cells) => cells
    .map((cell, column) => (
      column === cells.length - 1 ? cell : cell.padEnd(widths[column])
    ))
    .join('  ');

  return [
    formatRow(headers),
    widths.map((width) => '-'.repeat(width)).join('  '),
    ...rows.map(formatRow),
  ].join('\n');
}

async function main() {
  const flag = await ensureFlag();

  console.log('Switchboard demo — %20 → %40 rollout');
  console.log(`Servis: ${BASE_URL}`);
  console.log(
    `Flag: ${flag.key} (enabled=${flag.enabled}, rollout=${flag.rolloutPercentage}%)`,
  );
  console.log('');

  await setRollout(20);

  const at20 = [];

  for (const userId of DEMO_USERS) {
    at20.push(await evaluate(userId));
  }

  await setRollout(40);

  const at40 = [];

  for (const userId of DEMO_USERS) {
    at40.push(await evaluate(userId));
  }

  console.log(formatTable(at20, at40));
  console.log('');

  const openAt20 = at20.filter((result) => result.enabled).length;
  const openAt40 = at40.filter((result) => result.enabled).length;
  const newlyOpen = at40.filter(
    (result, index) => result.enabled && !at20[index].enabled,
  ).length;

  console.log(
    `Özet: %20'de ${openAt20}/${DEMO_USERS.length} açık, `
      + `%40'ta ${openAt40}/${DEMO_USERS.length} açık, `
      + `${openAt20} korundu, ${newlyOpen} yeni açıldı.`,
  );
  console.log('Demo sonunda flag %40 rollout ile açık bırakıldı.');
}

main().catch((error) => {
  console.error(`Hata: ${error.message}`);

  if (error.status === 401) {
    console.error('ADMIN_TOKEN değerini kontrol edin.');
  }

  process.exitCode = 1;
});
