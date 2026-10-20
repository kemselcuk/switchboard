const TOKEN_STORAGE_KEY = 'switchboard.v2.adminToken';

function byId(id) {
  return document.getElementById(id);
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
    // sessionStorage can be unavailable.
  }
}

function setStatus(id, message, kind = 'info') {
  const node = byId(id);

  node.textContent = message;
  node.dataset.kind = kind;
}

async function request(path, { method = 'GET', body, admin = true } = {}) {
  const headers = { accept: 'application/json' };

  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (admin) {
    const token = readToken();

    if (!token) {
      throw new Error('Admin token is required');
    }
    headers.authorization = `Bearer ${token}`;
  }

  const response = await fetch(path, {
    method,
    headers,
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

  if (!response.ok) {
    const error = new Error(
      payload?.error?.message ?? `HTTP ${response.status}`,
    );

    error.status = response.status;
    throw error;
  }

  return payload;
}

function setBusy(button, busy) {
  button.disabled = busy;
}

async function checkHealth() {
  const node = byId('health-status');

  try {
    const response = await fetch('/healthz');

    if (!response.ok) throw new Error('unhealthy');
    node.textContent = 'Healthy';
    node.dataset.state = 'ok';
  } catch {
    node.textContent = 'Unavailable';
    node.dataset.state = 'error';
  }
}

async function withForm(formId, statusId, action) {
  const form = byId(formId);
  const button = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    setBusy(button, true);
    setStatus(statusId, 'Working…');

    try {
      await action();
    } catch (error) {
      setStatus(statusId, error.message, 'error');
    } finally {
      setBusy(button, false);
    }
  });
}

function bindEvents() {
  byId('token-form').addEventListener('submit', (event) => {
    event.preventDefault();
    storeToken(byId('admin-token').value.trim());
    setStatus(
      'token-status',
      readToken() ? 'Admin token saved for this tab.' : 'No token saved.',
      readToken() ? 'ok' : 'warning',
    );
  });

  withForm('project-form', 'project-status', async () => {
    const project = await request('/api/v1/projects', {
      method: 'POST',
      body: {
        key: byId('project-key').value.trim(),
        name: byId('project-name').value.trim(),
      },
    });

    byId('env-project').value = project.key;
    byId('flag-project').value = project.key;
    byId('key-project').value = project.key;
    setStatus('project-status', `Project created: ${project.key}`, 'ok');
  });

  withForm('environment-form', 'environment-status', async () => {
    const project = byId('env-project').value.trim();
    const environment = await request(
      `/api/v1/projects/${encodeURIComponent(project)}/environments`,
      {
        method: 'POST',
        body: {
          key: byId('env-key').value.trim(),
          name: byId('env-name').value.trim(),
        },
      },
    );

    byId('flag-env').value = environment.key;
    byId('key-env').value = environment.key;
    setStatus('environment-status', `Environment created: ${environment.key}`, 'ok');
  });

  withForm('flag-form', 'flag-status', async () => {
    const project = byId('flag-project').value.trim();
    const environment = byId('flag-env').value.trim();
    const flagKey = byId('flag-key').value.trim();
    const path = `/api/v1/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(environment)}/flags/${encodeURIComponent(flagKey)}`;
    const payload = {
      description: byId('flag-description').value.trim(),
      enabled: byId('flag-enabled').checked,
      rolloutPercentage: Number(byId('flag-rollout').value),
    };

    let flag;

    try {
      flag = await request(path, { method: 'PATCH', body: payload });
    } catch (error) {
      if (error.status !== 404) throw error;
      flag = await request(
        `/api/v1/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(environment)}/flags`,
        {
          method: 'POST',
          body: {
            key: flagKey,
            description: payload.description,
            enabled: payload.enabled,
            rolloutPercentage: payload.rolloutPercentage,
          },
        },
      );
    }

    byId('evaluate-flag').value = flag.key;
    setStatus('flag-status', `Flag saved: ${flag.key} (${flag.rolloutPercentage}%)`, 'ok');
  });

  withForm('key-form', 'key-status', async () => {
    const project = byId('key-project').value.trim();
    const environment = byId('key-env').value.trim();
    const result = await request(
      `/api/v1/projects/${encodeURIComponent(project)}/environments/${encodeURIComponent(environment)}/api-keys`,
      {
        method: 'POST',
        body: { name: byId('key-name').value.trim() },
      },
    );
    const secret = byId('api-key-secret');

    secret.textContent = result.key;
    secret.hidden = false;
    byId('evaluate-key').value = result.key;
    setStatus('key-status', `API key created: ${result.prefix}`, 'ok');
  });

  withForm('evaluate-form', 'evaluate-status', async () => {
    const key = byId('evaluate-key').value.trim();
    const flagKey = byId('evaluate-flag').value.trim();
    const userId = byId('evaluate-user').value.trim();
    const result = await request(
      `/ofrep/v1/evaluate/flags/${encodeURIComponent(flagKey)}`,
      {
        method: 'POST',
        admin: false,
        body: { context: { targetingKey: userId } },
      },
    );
    const card = byId('evaluate-result');

    byId('result-value').textContent = String(result.value);
    byId('result-reason').textContent = result.reason ?? '—';
    byId('result-variant').textContent = result.variant ?? '—';
    byId('result-error').textContent = result.errorCode ?? '—';
    card.hidden = false;
    setStatus('evaluate-status', 'Evaluation complete.', 'ok');
  });
}

function init() {
  byId('admin-token').value = readToken();
  setStatus(
    'token-status',
    readToken() ? 'Admin token saved for this tab.' : 'No token saved.',
    readToken() ? 'ok' : 'warning',
  );
  bindEvents();
  void checkHealth();
}

init();
