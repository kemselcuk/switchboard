const METRICS_CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';
const DURATION_BUCKETS = [
  0.001,
  0.005,
  0.01,
  0.025,
  0.05,
  0.1,
  0.25,
  0.5,
  1,
  2.5,
  5,
  10,
];

function escapeLabel(value) {
  return String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('\n', '\\n');
}

function labelString(labels = {}) {
  const keys = Object.keys(labels).sort();

  if (keys.length === 0) {
    return '';
  }

  return `{${keys
    .map((key) => `${key}="${escapeLabel(labels[key])}"`)
    .join(',')}}`;
}

function formatValue(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(6);
}

function createCounter(name, help) {
  return { name, help, values: new Map() };
}

function createHistogram(name, help, buckets) {
  return { name, help, buckets, values: new Map() };
}

function addCounter(counter, labels, amount = 1) {
  const key = labelString(labels);
  counter.values.set(key, (counter.values.get(key) ?? 0) + amount);
}

function observeHistogram(histogram, labels, value) {
  const key = labelString(labels);
  let entry = histogram.values.get(key);

  if (!entry) {
    entry = {
      buckets: new Array(histogram.buckets.length).fill(0),
      sum: 0,
      count: 0,
    };
    histogram.values.set(key, entry);
  }

  for (let index = 0; index < histogram.buckets.length; index += 1) {
    if (value <= histogram.buckets[index]) {
      entry.buckets[index] += 1;
    }
  }

  entry.sum += value;
  entry.count += 1;
}

export function createMetrics() {
  const httpRequests = createCounter(
    'switchboard_http_requests_total',
    'HTTP responses by method, route template and status.',
  );
  const httpDuration = createHistogram(
    'switchboard_http_request_duration_seconds',
    'HTTP response time in seconds.',
    DURATION_BUCKETS,
  );
  const evaluations = createCounter(
    'switchboard_flag_evaluations_total',
    'Flag evaluations by result reason.',
  );
  const dbFailures = createCounter(
    'switchboard_db_failures_total',
    'Responses mapped to 503 EVALUATION_UNAVAILABLE.',
  );

  function renderCounter(counter) {
    const lines = [
      `# HELP ${counter.name} ${counter.help}`,
      `# TYPE ${counter.name} counter`,
    ];

    for (const [labels, value] of counter.values) {
      lines.push(`${counter.name}${labels} ${formatValue(value)}`);
    }

    return lines;
  }

  function renderHistogram(histogram) {
    const lines = [
      `# HELP ${histogram.name} ${histogram.help}`,
      `# TYPE ${histogram.name} histogram`,
    ];

    for (const [labels, entry] of histogram.values) {
      for (let index = 0; index < histogram.buckets.length; index += 1) {
        const bucketLabels = labels
          ? `${labels.slice(0, -1)},le="${histogram.buckets[index]}"}`
          : `{le="${histogram.buckets[index]}"}`;

        lines.push(
          `${histogram.name}_bucket${bucketLabels} ${entry.buckets[index]}`,
        );
      }

      const infinityLabels = labels
        ? `${labels.slice(0, -1)},le="+Inf"}`
        : '{le="+Inf"}';

      lines.push(`${histogram.name}_bucket${infinityLabels} ${entry.count}`);
      lines.push(`${histogram.name}_sum${labels} ${formatValue(entry.sum)}`);
      lines.push(`${histogram.name}_count${labels} ${entry.count}`);
    }

    return lines;
  }

  return {
    recordHttpRequest({ method, route, status, durationSeconds }) {
      const labels = { method, route, status: String(status) };

      addCounter(httpRequests, labels);
      observeHistogram(httpDuration, labels, durationSeconds);
    },
    recordEvaluation(result) {
      addCounter(evaluations, { result: result ?? 'UNKNOWN' });
    },
    recordDbFailure() {
      addCounter(dbFailures);
    },
    render() {
      return [
        ...renderCounter(httpRequests),
        ...renderHistogram(httpDuration),
        ...renderCounter(evaluations),
        ...renderCounter(dbFailures),
        '',
      ].join('\n');
    },
  };
}

export { METRICS_CONTENT_TYPE };
