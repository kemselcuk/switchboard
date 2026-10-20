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

function normalizeContext(
  context: EvaluationContext | undefined,
): EvaluationContext {
  return {
    ...context,
    targetingKey: context?.targetingKey ?? 'anonymous',
  };
}

export class SwitchboardClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly fetchFn: typeof fetch;

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
  }

  async getBooleanDetails(
    flagKey: string,
    defaultValue = false,
    context: EvaluationContext = {},
  ): Promise<BooleanEvaluationDetails> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchFn(
        `${this.baseUrl}/ofrep/v1/evaluate/flags/${encodeURIComponent(flagKey)}`,
        {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-api-key': this.apiKey,
          },
          body: JSON.stringify({ context: normalizeContext(context) }),
          signal: controller.signal,
        },
      );

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
    } catch (error) {
      const isAbort = error instanceof Error && error.name === 'AbortError';

      return {
        key: flagKey,
        value: defaultValue,
        reason: 'ERROR',
        errorCode: isAbort ? 'TIMEOUT' : 'NETWORK_ERROR',
        errorMessage: isAbort
          ? `Switchboard request timed out after ${this.timeoutMs}ms`
          : 'Switchboard could not be reached',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async getBooleanValue(
    flagKey: string,
    defaultValue = false,
    context: EvaluationContext = {},
  ): Promise<boolean> {
    return (await this.getBooleanDetails(flagKey, defaultValue, context)).value;
  }
}
