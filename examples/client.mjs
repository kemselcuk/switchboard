const HELP = `Switchboard örnek istemcisi

Kullanım:
  node examples/client.mjs --flag <key> --users <id1,id2,...> [--url <baseUrl>]

Seçenekler:
  --url    Servis adresi (varsayılan: http://127.0.0.1:3000)
  --flag   Değerlendirilecek flag anahtarı
  --users  Virgülle ayrılmış kullanıcı ID'leri
  --help   Bu yardımı göster

Ortam değişkenleri:
  SWITCHBOARD_URL, SWITCHBOARD_FLAG, SWITCHBOARD_USERS

Çıkış kodları:
  0  Tüm değerlendirmeler başarılı
  1 HTTP veya ağ hatası
  2  Servis 503 döndürdü; enabled=false fallback kullanıldı
`;

class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

function readOption(argv, index, name) {
  const value = argv[index + 1];

  if (!value || value.startsWith('--')) {
    throw new UsageError(`${name} için bir değer gerekli.`);
  }

  return value;
}

function parseArgs(argv) {
  const options = {
    url: process.env.SWITCHBOARD_URL ?? 'http://127.0.0.1:3000',
    flag: process.env.SWITCHBOARD_FLAG ?? '',
    users: process.env.SWITCHBOARD_USERS ?? '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--help' || argument === '-h') {
      return { help: true };
    }
    if (argument === '--url') {
      options.url = readOption(argv, index, '--url');
      index += 1;
      continue;
    }
    if (argument === '--flag') {
      options.flag = readOption(argv, index, '--flag');
      index += 1;
      continue;
    }
    if (argument === '--users') {
      options.users = readOption(argv, index, '--users');
      index += 1;
      continue;
    }

    throw new UsageError(`Bilinmeyen argüman: ${argument}`);
  }

  options.url = options.url.replace(/\/+$/, '');

  const users = String(options.users)
    .split(',')
    .map((userId) => userId.trim())
    .filter((userId) => userId.length > 0);

  if (!options.flag) {
    throw new UsageError('Flag gerekli: --flag veya SWITCHBOARD_FLAG.');
  }
  if (users.length === 0) {
    throw new UsageError('En az bir kullanıcı gerekli: --users veya SWITCHBOARD_USERS.');
  }

  return {
    help: false,
    url: options.url,
    flag: options.flag,
    users,
  };
}

function formatTable(results) {
  const headers = ['USER', 'ENABLED', 'REASON', 'BUCKET', 'ROLLOUT'];
  const rows = results.map((result) => [
    result.userId,
    String(result.enabled),
    result.reason,
    result.bucket === null || result.bucket === undefined
      ? '—'
      : String(result.bucket),
    result.rolloutPercentage === null || result.rolloutPercentage === undefined
      ? '—'
      : `${result.rolloutPercentage}%`,
  ]);
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

async function evaluate({ url, flag, userId }) {
  let response;

  try {
    response = await fetch(`${url}/api/evaluate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flagKey: flag, userId }),
    });
  } catch (error) {
    throw new Error(`${url} adresine ulaşılamadı: ${error.message}`);
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

  if (response.status === 503) {
    return {
      unavailable: true,
      result: {
        userId,
        enabled: false,
        reason: 'EVALUATION_UNAVAILABLE_FALLBACK',
        bucket: null,
        rolloutPercentage: null,
      },
    };
  }

  if (!response.ok) {
    const message = payload?.error?.message ?? response.statusText;

    throw new Error(
      `POST /api/evaluate → HTTP ${response.status}: ${message}`,
    );
  }

  return { unavailable: false, result: payload };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(HELP);
    return 0;
  }

  const results = [];
  let sawUnavailable = false;

  for (const userId of options.users) {
    const { unavailable, result } = await evaluate({
      url: options.url,
      flag: options.flag,
      userId,
    });

    results.push(result);

    if (unavailable) {
      sawUnavailable = true;
      console.error(
        `UYARI: ${userId} için servis 503 döndürdü; enabled=false fallback kullanıldı.`,
      );
    }
  }

  process.stdout.write(`${formatTable(results)}\n`);

  if (sawUnavailable) {
    console.error('Servis geçici olarak kullanılamıyor; fallback sonuçları gösterildi.');
    return 2;
  }

  return 0;
}

main()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    if (error instanceof UsageError) {
      console.error(`Hata: ${error.message}`);
      console.error('Yardım için: node examples/client.mjs --help');
    } else {
      console.error(`Hata: ${error.message}`);
    }

    process.exitCode = 1;
  });
