export type EvaluationContext = {
  targetingKey?: string;
  [attribute: string]: unknown;
};

export type SwitchboardErrorCode =
  | 'FLAG_NOT_FOUND'
  | 'UNAUTHORIZED'
  | 'EVALUATION_UNAVAILABLE'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'TYPE_MISMATCH'
  | 'GENERAL';

export type BooleanEvaluationDetails = {
  key: string;
  value: boolean;
  reason: string;
  variant?: string;
  errorCode?: SwitchboardErrorCode;
  errorMessage?: string;
};

export type SwitchboardClientOptions = {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  bulkEvaluation?: boolean;
  pollingIntervalMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
};

export class SwitchboardError extends Error {
  readonly code: SwitchboardErrorCode;
  readonly status?: number;

  constructor(
    code: SwitchboardErrorCode,
    message: string,
    status?: number,
  ) {
    super(message);
    this.name = 'SwitchboardError';
    this.code = code;
    this.status = status;
  }
}

type BulkFlagState = {
  value: unknown;
  reason: string;
  variant?: string;
};

type BulkFetchOutcome =
  | { ok: true }
  | {
      ok: false;
      errorCode: SwitchboardErrorCode;
      errorMessage: string;
    };

type BulkCacheEntry = {
  context: EvaluationContext;
  flags?: Map<string, BulkFlagState>;
  etag?: string;
  refreshedAt: number;
  inFlight?: Promise<BulkFetchOutcome>;
  timer?: ReturnType<typeof setTimeout>;
};

type TransportResult =
  | { kind: 'response'; response: Response }
  | { kind: 'timeout' }
  | { kind: 'network' };

const DEFAULT_POLLING_INTERVAL_MS = 30000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 100;

function normalizeContext(
  context: EvaluationContext | undefined,
): EvaluationContext {
  return {
    ...context,
    targetingKey: context?.targetingKey ?? 'anonymous',
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value !== null && typeof value === 'object') {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};

    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) {
        sorted[key] = canonicalize(source[key]);
      }
    }

    return sorted;
  }

  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const unref = (timer as unknown as { unref?: () => void }).unref;

  if (typeof unref === 'function') {
    unref.call(timer);
  }
}

export class SwitchboardClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;
  private readonly bulkEvaluation: boolean;
  private readonly pollingIntervalMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly bulkCache = new Map<string, BulkCacheEntry>();
  private closed = false;

  constructor(options: SwitchboardClientOptions) {
    if (!options.baseUrl) {
      throw new Error('baseUrl is required');
    }
    if (!options.apiKey) {
      throw new Error('apiKey is required');
    }

    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs ?? 1000;
    this.fetchFn = options.fetch ?? fetch;
    this.bulkEvaluation = options.bulkEvaluation ?? false;
    this.pollingIntervalMs = Math.max(
      0,
      options.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS,
    );
    this.maxRetries = Math.max(
      0,
      Math.floor(options.maxRetries ?? DEFAULT_MAX_RETRIES),
    );
    this.retryBaseDelayMs = Math.max(
      0,
      options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS,
    );
  }

  close(): void {
    this.closed = true;

    for (const entry of this.bulkCache.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = undefined;
      }
    }

    this.bulkCache.clear();
  }

  async getBooleanDetails(
    flagKey: string,
    defaultValue = false,
    context: EvaluationContext = {},
  ): Promise<BooleanEvaluationDetails> {
    if (this.bulkEvaluation) {
      return this.getBulkBooleanDetails(flagKey, defaultValue, context);
    }

    return this.getSingleBooleanDetails(flagKey, defaultValue, context);
  }

  async getBooleanValue(
    flagKey: string,
    defaultValue = false,
    context: EvaluationContext = {},
  ): Promise<boolean> {
    return (await this.getBooleanDetails(flagKey, defaultValue, context)).value;
  }

  private async getSingleBooleanDetails(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): Promise<BooleanEvaluationDetails> {
    const transport = await this.sendWithRetries(
      `${this.baseUrl}/ofrep/v1/evaluate/flags/${encodeURIComponent(flagKey)}`,
      this.requestHeaders(),
      JSON.stringify({ context: normalizeContext(context) }),
    );

    if (transport.kind !== 'response') {
      return this.transportFailure(flagKey, defaultValue, transport.kind);
    }

    const response = transport.response;

    if (response.status === 404) {
      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'FLAG_NOT_FOUND',
        errorMessage: `Flag '${flagKey}' was not found`,
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'UNAUTHORIZED',
        errorMessage: 'Switchboard API key is missing, invalid or revoked',
      };
    }

    if (response.status === 503) {
      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'EVALUATION_UNAVAILABLE',
        errorMessage: 'Switchboard evaluation storage is unavailable',
      };
    }

    if (!response.ok) {
      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'GENERAL',
        errorMessage: `Switchboard HTTP ${response.status}`,
      };
    }

    const payload = await response.json() as {
      key?: unknown;
      value?: unknown;
      reason?: unknown;
      variant?: unknown;
    };

    if (typeof payload.value !== 'boolean') {
      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'TYPE_MISMATCH',
        errorMessage: 'Switchboard returned a non-boolean value',
      };
    }

    return {
      key: typeof payload.key === 'string' ? payload.key : flagKey,
      value: payload.value,
      reason: typeof payload.reason === 'string' ? payload.reason : 'UNKNOWN',
      variant: typeof payload.variant === 'string'
        ? payload.variant
        : undefined,
    };
  }

  private async getBulkBooleanDetails(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): Promise<BooleanEvaluationDetails> {
    const normalized = normalizeContext(context);
    const cacheKey = stableStringify(normalized);
    let entry = this.bulkCache.get(cacheKey);

    if (!entry) {
      entry = { context: normalized, refreshedAt: 0 };
      this.bulkCache.set(cacheKey, entry);
    }

    if (this.isCacheFresh(entry)) {
      return this.bulkDetails(entry, flagKey, defaultValue);
    }

    const outcome = await this.refreshBulk(cacheKey, entry);

    if (!outcome.ok) {
      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: outcome.errorCode,
        errorMessage: outcome.errorMessage,
      };
    }

    return this.bulkDetails(entry, flagKey, defaultValue);
  }

  private isCacheFresh(entry: BulkCacheEntry): boolean {
    if (!entry.flags) {
      return false;
    }

    if (this.pollingIntervalMs === 0) {
      return true;
    }

    return Date.now() - entry.refreshedAt < this.pollingIntervalMs;
  }

  private bulkDetails(
    entry: BulkCacheEntry,
    flagKey: string,
    defaultValue: boolean,
  ): BooleanEvaluationDetails {
    const flag = entry.flags?.get(flagKey);

    if (!flag) {
      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'FLAG_NOT_FOUND',
        errorMessage: `Flag '${flagKey}' was not found`,
      };
    }

    if (typeof flag.value !== 'boolean') {
      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: 'TYPE_MISMATCH',
        errorMessage: 'Switchboard returned a non-boolean value',
      };
    }

    return {
      key: flagKey,
      value: flag.value,
      reason: flag.reason,
      variant: flag.variant,
    };
  }

  private refreshBulk(
    cacheKey: string,
    entry: BulkCacheEntry,
  ): Promise<BulkFetchOutcome> {
    if (entry.inFlight) {
      return entry.inFlight;
    }

    const promise = this.fetchBulk(entry)
      .then((outcome) => {
        if (outcome.ok) {
          entry.refreshedAt = Date.now();
          this.schedulePoll(cacheKey, entry);
        }

        return outcome;
      })
      .catch((): BulkFetchOutcome => ({
        ok: false,
        errorCode: 'NETWORK_ERROR',
        errorMessage: 'Switchboard could not be reached',
      }))
      .finally(() => {
        if (entry.inFlight === promise) {
          entry.inFlight = undefined;
        }
      });

    entry.inFlight = promise;

    return promise;
  }

  private async fetchBulk(entry: BulkCacheEntry): Promise<BulkFetchOutcome> {
    const headers = this.requestHeaders();

    if (entry.etag) {
      headers['if-none-match'] = entry.etag;
    }

    const transport = await this.sendWithRetries(
      `${this.baseUrl}/ofrep/v1/evaluate/flags`,
      headers,
      JSON.stringify({ context: entry.context }),
    );

    if (transport.kind !== 'response') {
      return transport.kind === 'timeout'
        ? {
            ok: false,
            errorCode: 'TIMEOUT',
            errorMessage: `Switchboard request timed out after ${this.timeoutMs}ms`,
          }
        : {
            ok: false,
            errorCode: 'NETWORK_ERROR',
            errorMessage: 'Switchboard could not be reached',
          };
    }

    const response = transport.response;

    if (response.status === 304) {
      const etag = response.headers.get('etag');

      if (etag) {
        entry.etag = etag;
      }

      return { ok: true };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        ok: false,
        errorCode: 'UNAUTHORIZED',
        errorMessage: 'Switchboard API key is missing, invalid or revoked',
      };
    }

    if (response.status === 503) {
      return {
        ok: false,
        errorCode: 'EVALUATION_UNAVAILABLE',
        errorMessage: 'Switchboard evaluation storage is unavailable',
      };
    }

    if (!response.ok) {
      return {
        ok: false,
        errorCode: 'GENERAL',
        errorMessage: `Switchboard HTTP ${response.status}`,
      };
    }

    let payload: { flags?: unknown };

    try {
      payload = await response.json() as { flags?: unknown };
    } catch {
      return {
        ok: false,
        errorCode: 'GENERAL',
        errorMessage: 'Switchboard returned an invalid response',
      };
    }

    if (!Array.isArray(payload.flags)) {
      return {
        ok: false,
        errorCode: 'GENERAL',
        errorMessage: 'Switchboard returned an invalid response',
      };
    }

    const flags = new Map<string, BulkFlagState>();

    for (const item of payload.flags) {
      if (item === null || typeof item !== 'object') {
        continue;
      }

      const flag = item as {
        key?: unknown;
        value?: unknown;
        reason?: unknown;
        variant?: unknown;
      };

      if (typeof flag.key !== 'string') {
        continue;
      }

      flags.set(flag.key, {
        value: flag.value,
        reason: typeof flag.reason === 'string' ? flag.reason : 'UNKNOWN',
        variant: typeof flag.variant === 'string'
          ? flag.variant
          : undefined,
      });
    }

    entry.flags = flags;
    entry.etag = response.headers.get('etag') ?? undefined;

    return { ok: true };
  }

  private schedulePoll(cacheKey: string, entry: BulkCacheEntry): void {
    if (this.closed || this.pollingIntervalMs <= 0) {
      return;
    }

    if (entry.timer) {
      clearTimeout(entry.timer);
    }

    const timer = setTimeout(() => {
      entry.timer = undefined;
      void this.refreshBulk(cacheKey, entry)
        .catch(() => undefined)
        .finally(() => {
          this.schedulePoll(cacheKey, entry);
        });
    }, this.pollingIntervalMs);

    unrefTimer(timer);
    entry.timer = timer;
  }

  private requestHeaders(): Record<string, string> {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
    };
  }

  private transportFailure(
    flagKey: string,
    defaultValue: boolean,
    kind: 'timeout' | 'network',
  ): BooleanEvaluationDetails {
    const isTimeout = kind === 'timeout';

    return {
      key: flagKey,
      value: defaultValue,
      reason: 'ERROR',
      errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
      errorMessage: isTimeout
        ? `Switchboard request timed out after ${this.timeoutMs}ms`
        : 'Switchboard could not be reached',
    };
  }

  private async sendWithRetries(
    url: string,
    headers: Record<string, string>,
    body: string,
  ): Promise<TransportResult> {
    const attempts = this.maxRetries + 1;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      let result: TransportResult;

      try {
        const response = await this.fetchFn(url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        result = { kind: 'response', response };
      } catch (error) {
        const isAbort = error instanceof Error && error.name === 'AbortError';
        result = { kind: isAbort ? 'timeout' : 'network' };
      } finally {
        clearTimeout(timer);
      }

      const retryable = result.kind === 'timeout'
        || result.kind === 'network'
        || (result.kind === 'response' && result.response.status >= 500);

      if (!retryable || attempt === attempts - 1) {
        return result;
      }

      if (result.kind === 'response') {
        await result.response.body?.cancel().catch(() => undefined);
      }

      const delayMs = this.retryDelay(attempt);

      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }

    return { kind: 'network' };
  }

  private retryDelay(attempt: number): number {
    if (this.retryBaseDelayMs === 0) {
      return 0;
    }

    const exponential = this.retryBaseDelayMs * 2 ** attempt;
    const jitter = Math.random() * this.retryBaseDelayMs * 0.5;

    return exponential + jitter;
  }
}
