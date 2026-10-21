import {
  ErrorCode,
  type EvaluationContext,
  type JsonValue,
  type Provider,
  type ResolutionDetails,
} from '@openfeature/server-sdk';
import {
  SwitchboardClient,
  type EvaluationDetails,
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
      // UNAUTHORIZED, EVALUATION_UNAVAILABLE, TIMEOUT, NETWORK_ERROR, and
      // GENERAL have no dedicated OpenFeature code.
      return ErrorCode.GENERAL;
  }
}

function toResolution<T>(
  details: EvaluationDetails<T>,
): ResolutionDetails<T> {
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
      ...options,
      bulkEvaluation: options.bulkEvaluation ?? true,
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
    flagKey: string,
    defaultValue: string,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<string>> {
    const details = await this.client.getStringDetails(
      flagKey,
      defaultValue,
      context,
    );

    return toResolution(details);
  }

  async resolveNumberEvaluation(
    flagKey: string,
    defaultValue: number,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<number>> {
    const details = await this.client.getNumberDetails(
      flagKey,
      defaultValue,
      context,
    );

    return toResolution(details);
  }

  async resolveObjectEvaluation<T extends JsonValue>(
    flagKey: string,
    defaultValue: T,
    context: EvaluationContext,
  ): Promise<ResolutionDetails<T>> {
    const details = await this.client.getObjectDetails(
      flagKey,
      defaultValue as unknown as object,
      context,
    );

    return toResolution(details as EvaluationDetails<T>);
  }
}
