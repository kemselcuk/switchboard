const TOKEN_STORAGE_KEY = 'switchboard.adminToken';
const FLAG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
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

const state = {
  flags: [],
  flagsLoaded: false,
  evaluations: [],
};

class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

function byId(id) {
  return document.getElementById(id);
}

function element(tag, className, text) {
  const node = document.createElement(tag);

  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }

  return node;
}

function setStatus(node, message, kind = 'info') {
  node.textContent = message;
  node.dataset.kind = kind;
}

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeToken(token) {
  try {
    if (token) {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // sessionStorage may be unavailable in hardened browser modes.
  }
}

function errorMessage(code, serverMessage, status) {
  switch (code) {
    case 'FLAG_EXISTS':
      return 'Bu anahtarla bir flag zaten var.';
    case 'FLAG_NOT_FOUND':
      return 'Flag bulunamadı.';
    case 'VALIDATION_ERROR':
      return 'Girdiler geçersiz. Alanları kontrol edin.';
    case 'NOT_FOUND':
      return 'İstenen kaynak bulunamadı.';
    default:
      return serverMessage
        ? `İstek başarısız: ${serverMessage}`
        : `İstek başarısız (HTTP ${status}).`;
  }
}

async function request(path, { method = 'GET', body, admin = false } = {}) {
  const headers = { accept: 'application/json' };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  if (admin) {
    const token = readToken();

    if (!token) {
      throw new ApiError(
        'ADMIN_TOKEN_MISSING',
        'Admin token gerekli. Önce token kaydedin.',
      );
    }

    headers.authorization = `Bearer ${token}`;
  }

  let response;

  try {
    response = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(
      'NETWORK_ERROR',
      'Sunucuya ulaşılamadı. Servisin çalıştığını kontrol edin.',
    );
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
    if (response.status === 401) {
      throw new ApiError('UNAUTHORIZED', 'Admin token geçersiz');
    }
    if (response.status === 503) {
      throw new ApiError(
        'EVALUATION_UNAVAILABLE',
        'Servis geçici olarak kullanılamıyor',
      );
    }

    const code = payload?.error?.code ?? `HTTP_${response.status}`;

    throw new ApiError(
      code,
      errorMessage(code, payload?.error?.message, response.status),
    );
  }

  return payload;
}

function updateTokenStatus() {
  const status = byId('token-status');

  if (readToken()) {
    setStatus(status, 'Admin token bu sekme için kaydedildi.', 'ok');
  } else {
    setStatus(status, 'Token yok. Yönetim çağrıları yapılmaz.', 'warning');
  }
}

async function checkHealth() {
  const badge = byId('health-status');

  badge.textContent = 'Kontrol ediliyor…';
  badge.dataset.state = 'pending';

  try {
    const response = await fetch('/healthz');

    if (!response.ok) {
      throw new Error('unhealthy');
    }

    const payload = await response.json();

    if (payload?.status !== 'ok') {
      throw new Error('unhealthy');
    }

    badge.textContent = 'Sağlıklı';
    badge.dataset.state = 'ok';
  } catch {
    badge.textContent = 'Ulaşılamıyor';
    badge.dataset.state = 'error';
  }
}

function renderFlagOptions() {
  const select = byId('evaluate-flag');
  const previous = select.value;

  select.replaceChildren();

  if (state.flags.length === 0) {
    const option = document.createElement('option');

    option.value = '';
    option.textContent = 'Flag yok';
    option.disabled = true;
    option.selected = true;
    select.append(option);
    select.disabled = true;
  } else {
    select.disabled = false;

    for (const flag of state.flags) {
      const option = document.createElement('option');

      option.value = flag.key;
      option.textContent = flag.enabled ? flag.key : `${flag.key} (kapalı)`;
      select.append(option);
    }

    if (state.flags.some((flag) => flag.key === previous)) {
      select.value = previous;
    }
  }

  updateCompareFlagLabel();
}

function updateCompareFlagLabel() {
  const key = byId('evaluate-flag').value;
  const label = byId('compare-flag-label');

  label.textContent = key
    ? `Seçili flag: ${key}`
    : 'Önce Değerlendir bölümünden bir flag seçin.';
}

function renderFlagList() {
  const container = byId('flag-list');

  container.replaceChildren();

  if (!readToken()) {
    container.append(
      element('p', 'empty', 'Flag listesi için admin token kaydedin.'),
    );
    return;
  }

  if (!state.flagsLoaded) {
    container.append(element('p', 'empty', 'Flag listesi yükleniyor…'));
    return;
  }

  if (state.flags.length === 0) {
    container.append(
      element('p', 'empty', 'Henüz flag yok. Yukarıdan oluşturabilirsiniz.'),
    );
    return;
  }

  for (const flag of state.flags) {
    container.append(createFlagCard(flag));
  }
}

function createFlagCard(flag) {
  const card = element('article', 'flag-card');
  const heading = element('div', 'flag-card__heading');
  const controls = element('div', 'flag-card__controls');
  const status = element('p', 'status status--inline');

  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  heading.append(
    element('code', 'flag-key', flag.key),
    element('p', 'flag-description', flag.description || 'Açıklama yok.'),
  );

  const enabledLabel = element('label', 'inline-field');
  const enabled = document.createElement('input');

  enabled.type = 'checkbox';
  enabled.checked = Boolean(flag.enabled);
  enabledLabel.append(enabled, document.createTextNode(' Açık'));

  const rolloutLabel = element('div', 'inline-field');
  const range = document.createElement('input');
  const number = document.createElement('input');
  const output = element(
    'output',
    'rollout-output',
    `${flag.rolloutPercentage}%`,
  );

  range.type = 'range';
  range.min = '0';
  range.max = '100';
  range.step = '1';
  range.value = String(flag.rolloutPercentage);
  range.setAttribute('aria-label', `${flag.key} rollout kaydırıcısı`);

  number.type = 'number';
  number.min = '0';
  number.max = '100';
  number.step = '1';
  number.value = String(flag.rolloutPercentage);
  number.className = 'rollout-number';
  number.setAttribute('aria-label', `${flag.key} rollout yüzdesi`);

  range.addEventListener('input', () => {
    number.value = range.value;
    output.textContent = `${range.value}%`;
  });

  number.addEventListener('input', () => {
    const value = Number(number.value);

    if (
      number.value !== ''
      && Number.isInteger(value)
      && value >= 0
      && value <= 100
    ) {
      range.value = String(value);
      output.textContent = `${value}%`;
    }
  });

  rolloutLabel.append(
    document.createTextNode('Rollout '),
    range,
    number,
    output,
  );

  const save = element('button', 'button button--secondary', 'Kaydet');

  save.type = 'button';
  save.addEventListener('click', async () => {
    const rollout = Number(number.value);

    if (
      number.value === ''
      || !Number.isInteger(rollout)
      || rollout < 0
      || rollout > 100
    ) {
      setStatus(
        status,
        'Rollout 0–100 arasında bir tam sayı olmalı.',
        'error',
      );
      return;
    }

    save.disabled = true;
    setStatus(status, 'Kaydediliyor…', 'info');

    try {
      const updated = await request(
        `/api/flags/${encodeURIComponent(flag.key)}`,
        {
          method: 'PATCH',
          admin: true,
          body: { enabled: enabled.checked, rolloutPercentage: rollout },
        },
      );

      setStatus(byId('flags-status'), `Flag güncellendi: ${updated.key}`, 'ok');
      await loadFlags({ silent: true });
    } catch (error) {
      setStatus(status, error.message, 'error');
      save.disabled = false;
    }
  });

  controls.append(enabledLabel, rolloutLabel, save);
  card.append(heading, controls, status);

  return card;
}

async function loadFlags({ silent = false } = {}) {
  const status = byId('flags-status');

  if (!readToken()) {
    state.flags = [];
    state.flagsLoaded = false;
    renderFlagList();
    renderFlagOptions();

    if (!silent) {
      setStatus(
        status,
        'Admin token gerekli. Flag listesi için token kaydedin.',
        'warning',
      );
    }
    return;
  }

  if (!silent) {
    setStatus(status, 'Flag listesi yükleniyor…', 'info');
  }

  try {
    const payload = await request('/api/flags', { admin: true });

    state.flags = Array.isArray(payload?.flags) ? payload.flags : [];
    state.flagsLoaded = true;
    renderFlagList();
    renderFlagOptions();

    if (!silent) {
      setStatus(
        status,
        state.flags.length === 0
          ? 'Henüz flag yok. Yukarıdan oluşturabilirsiniz.'
          : '',
        'info',
      );
    }
  } catch (error) {
    state.flags = [];
    state.flagsLoaded = false;
    renderFlagList();
    renderFlagOptions();
    setStatus(status, error.message, 'error');
  }
}

function renderEvaluationResult(result) {
  const card = byId('evaluation-result');
  const enabled = byId('result-enabled');

  byId('result-flag').textContent = result.flagKey;
  byId('result-user').textContent = result.userId;
  byId('result-reason').textContent = result.reason;
  byId('result-bucket').textContent = result.bucket ?? '—';
  byId('result-rollout').textContent = result.rolloutPercentage === null
    ? '—'
    : `${result.rolloutPercentage}%`;

  enabled.textContent = result.enabled ? 'Açık' : 'Kapalı';
  enabled.dataset.state = result.enabled ? 'on' : 'off';

  card.hidden = false;
}

function addEvaluationToHistory(result) {
  state.evaluations.unshift({
    at: new Date().toLocaleTimeString('tr-TR', { hour12: false }),
    flagKey: result.flagKey,
    userId: result.userId,
    enabled: result.enabled,
    reason: result.reason,
    bucket: result.bucket,
  });
  state.evaluations = state.evaluations.slice(0, 10);
  renderHistory();
}

function renderHistory() {
  const body = byId('history-body');

  body.replaceChildren();

  if (state.evaluations.length === 0) {
    const row = document.createElement('tr');
    const cell = element('td', 'empty', 'Henüz değerlendirme yok.');

    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
    return;
  }

  for (const evaluation of state.evaluations) {
    const row = document.createElement('tr');
    const enabled = element(
      'td',
      '',
      evaluation.enabled ? 'Açık' : 'Kapalı',
    );

    enabled.dataset.state = evaluation.enabled ? 'on' : 'off';

    row.append(
      element('td', '', evaluation.at),
      element('td', '', evaluation.flagKey),
      element('td', '', evaluation.userId),
      enabled,
      element('td', '', evaluation.reason),
      element('td', '', evaluation.bucket ?? '—'),
    );
    body.append(row);
  }
}

function resetComparison() {
  byId('compare-table-container').hidden = true;
  byId('compare-summary').hidden = true;
  byId('compare-body').replaceChildren();
}

function comparisonOutcome(first, second) {
  if (first.enabled) {
    return { label: 'korundu', state: 'kept' };
  }
  if (second.enabled) {
    return { label: 'yeni açıldı', state: 'new' };
  }
  return { label: 'kapalı', state: 'off' };
}

function renderComparison(at20, at40) {
  const body = byId('compare-body');

  body.replaceChildren();

  for (let index = 0; index < at20.length; index += 1) {
    const first = at20[index];
    const second = at40[index];
    const outcome = comparisonOutcome(first, second);
    const row = document.createElement('tr');
    const at20Cell = element('td', '', first.enabled ? 'Açık' : 'Kapalı');
    const at40Cell = element('td', '', second.enabled ? 'Açık' : 'Kapalı');
    const outcomeCell = element('td', '', outcome.label);

    at20Cell.dataset.state = first.enabled ? 'on' : 'off';
    at40Cell.dataset.state = second.enabled ? 'on' : 'off';
    outcomeCell.dataset.state = outcome.state;

    row.append(
      element('td', '', first.userId),
      element('td', '', first.bucket ?? '—'),
      at20Cell,
      at40Cell,
      outcomeCell,
    );
    body.append(row);
  }

  const openAt20 = at20.filter((result) => result.enabled).length;
  const openAt40 = at40.filter((result) => result.enabled).length;
  const newlyOpen = at40.filter(
    (result, index) => result.enabled && !at20[index].enabled,
  ).length;
  const summary = byId('compare-summary');

  summary.textContent = [
    `%20: ${openAt20}/${at20.length} açık`,
    `%40: ${openAt40}/${at40.length} açık`,
    `${openAt20} korundu`,
    `${newlyOpen} yeni açıldı`,
  ].join(' · ');
  summary.hidden = false;
  byId('compare-table-container').hidden = false;
}

async function evaluateDemoUsers(flagKey) {
  const results = [];

  for (const userId of DEMO_USERS) {
    results.push(
      await request('/api/evaluate', {
        method: 'POST',
        body: { flagKey, userId },
      }),
    );
  }

  return results;
}

async function runComparison() {
  const status = byId('compare-status');
  const button = byId('compare-run');
  const flagKey = byId('evaluate-flag').value;

  if (!readToken()) {
    setStatus(
      status,
      'Admin token gerekli. Karşılaştırma için token kaydedin.',
      'warning',
    );
    return;
  }

  if (!flagKey) {
    setStatus(status, 'Önce bir flag oluşturun.', 'warning');
    return;
  }

  const flag = state.flags.find((item) => item.key === flagKey);

  if (!flag) {
    setStatus(status, 'Flag bulunamadı. Listeyi yenileyin.', 'error');
    return;
  }

  if (!flag.enabled) {
    resetComparison();
    setStatus(status, 'Flag kapalı; önce açın.', 'warning');
    return;
  }

  button.disabled = true;
  resetComparison();
  setStatus(status, 'Karşılaştırma çalışıyor…', 'info');

  try {
    await request(`/api/flags/${encodeURIComponent(flagKey)}`, {
      method: 'PATCH',
      admin: true,
      body: { rolloutPercentage: 20 },
    });

    const at20 = await evaluateDemoUsers(flagKey);

    await request(`/api/flags/${encodeURIComponent(flagKey)}`, {
      method: 'PATCH',
      admin: true,
      body: { rolloutPercentage: 40 },
    });

    const at40 = await evaluateDemoUsers(flagKey);

    renderComparison(at20, at40);
    await loadFlags({ silent: true });
    setStatus(
      status,
      'Karşılaştırma tamamlandı. Flag %40 açık kaldı.',
      'ok',
    );
  } catch (error) {
    setStatus(
      status,
      `${error.message}. Karşılaştırma tamamlanamadı.`,
      'error',
    );
  } finally {
    button.disabled = false;
  }
}

function bindEvents() {
  byId('token-form').addEventListener('submit', (event) => {
    event.preventDefault();

    const input = byId('admin-token');
    const token = input.value.trim();

    storeToken(token);

    if (!token) {
      updateTokenStatus();
      void loadFlags();
      return;
    }

    updateTokenStatus();
    void loadFlags();
  });

  byId('create-flag-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const status = byId('create-status');
    const submit = form.querySelector('button[type="submit"]');

    if (!readToken()) {
      setStatus(status, 'Admin token gerekli. Önce token kaydedin.', 'warning');
      return;
    }

    const key = byId('flag-key').value.trim();
    const description = byId('flag-description').value.trim();
    const enabled = byId('flag-enabled').checked;
    const rollout = Number(byId('flag-rollout').value);

    if (!FLAG_KEY_PATTERN.test(key)) {
      setStatus(
        status,
        'Anahtar küçük harf veya rakamla başlamalı; a-z, 0-9, nokta, tire ve alt çizgi içermeli (en fazla 64 karakter).',
        'error',
      );
      return;
    }

    if (
      byId('flag-rollout').value === ''
      || !Number.isInteger(rollout)
      || rollout < 0
      || rollout > 100
    ) {
      setStatus(
        status,
        'Rollout 0–100 arasında bir tam sayı olmalı.',
        'error',
      );
      return;
    }

    submit.disabled = true;
    setStatus(status, 'Flag oluşturuluyor…', 'info');

    try {
      const flag = await request('/api/flags', {
        method: 'POST',
        admin: true,
        body: { key, description, enabled, rolloutPercentage: rollout },
      });

      setStatus(status, `Flag oluşturuldu: ${flag.key}`, 'ok');
      form.reset();
      byId('flag-rollout').value = '0';
      await loadFlags({ silent: true });
      setStatus(
        byId('flags-status'),
        `Flag listesi güncel: ${flag.key}`,
        'ok',
      );
    } catch (error) {
      setStatus(status, error.message, 'error');
    } finally {
      submit.disabled = false;
    }
  });

  byId('evaluate-form').addEventListener('submit', async (event) => {
    event.preventDefault();

    const status = byId('evaluate-status');
    const flagKey = byId('evaluate-flag').value;
    const userId = byId('evaluate-user').value;

    if (!flagKey) {
      setStatus(status, 'Önce bir flag oluşturun.', 'warning');
      return;
    }

    if (userId.length === 0) {
      setStatus(status, 'Kullanıcı ID gerekli.', 'warning');
      return;
    }

    try {
      const result = await request('/api/evaluate', {
        method: 'POST',
        body: { flagKey, userId },
      });

      renderEvaluationResult(result);
      addEvaluationToHistory(result);
      setStatus(status, '', 'info');
    } catch (error) {
      setStatus(status, error.message, 'error');
    }
  });

  byId('evaluate-flag').addEventListener('change', updateCompareFlagLabel);
  byId('compare-run').addEventListener('click', () => {
    void runComparison();
  });
}

function init() {
  byId('admin-token').value = readToken();
  updateTokenStatus();

  bindEvents();
  renderFlagList();
  renderFlagOptions();
  renderHistory();
  void checkHealth();

  if (readToken()) {
    void loadFlags();
  } else {
    setStatus(
      byId('flags-status'),
      'Admin token gerekli. Flag listesi için token kaydedin.',
      'warning',
    );
  }
}

init();
