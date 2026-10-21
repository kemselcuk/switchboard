import {
  ErrorCode,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from '@openfeature/server-sdk';
import {
  SwitchboardClient,
  type BooleanEvaluationDetails,
  type SwitchboardClientOptions,
  type SwitchboardErrorCode,
} from '@switchboard/sdk';

export type SwitchboardProviderOptions = SwitchboardClientOptions;

function mapError(code: SwitchboardErrorCode): ErrorCode {
  switch (code) {
    case 'FLAG_NOT_FOUND':
      return ErrorCode.FLAG_NOT_FOUND;
    case 'TYPE_MISMATCH':
      return ErrorCode.TYPE_MISMATCH;
    default:
      return ErrorCode.GENERAL;
  }
}

function toResolution(
  details: BooleanEvaluationDetails,
): ResolutionDetails<boolean> {
  return {
    value: details.value,
    reason: details.reason,
    variant: details.variant,
    ...(details.errorCode
      ? {
          errorCode: mapError(details.errorCode),
          errorMessage: details.errorMessage,
        }
      : {}),
  };
}

export class SwitchboardProvider implements Provider {
  readonly metadata = {
    name: 'Switchboard',
  };

  readonly runsOn = 'server' as const;

  private readonly client: SwitchboardClient;

  constructor(options: SwitchboardProviderOptions) {
    this.client = new SwitchboardClient({
      bulkEvaluation: true,
      ...options,
    });
  }

  async onClose(): Promise<void> {
    this.client.close();
  }

  async resolveBooleanEvaluation(
    flagKey: string,
    defaultValue: boolean,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<boolean>> {
    const details = await this.client.getBooleanDetails(
      flagKey,
      defaultValue,
      context,
    );

    return toResolution(details);
  }

  async resolveStringEvaluation(
    _flagKey: string,
    defaultValue: string,
  ): Promise<ResolutionDetails<string>> {
    return {
      value: defaultValue,
      reason: 'ERROR',
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: 'Switchboard v2.0 supports boolean flags only',
    };
  }

  async resolveNumberEvaluation(
    _flagKey: string,
    defaultValue: number,
  ): Promise<ResolutionDetails<number>> {
    return {
      value: defaultValue,
      reason: 'ERROR',
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: 'Switchboard v2.0 supports boolean flags only',
    };
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    _flagKey: string,
    defaultValue: T,
  ): Promise<ResolutionDetails<T>> {
    return {
      value: defaultValue,
      reason: 'ERROR',
      errorCode: ErrorCode.TYPE_MISMATCH,
      errorMessage: 'Switchboard v2.0 supports boolean flags only',
    };
  }
}
