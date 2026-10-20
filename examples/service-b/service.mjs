import { OpenFeature } from '@openfeature/server-sdk';
import { SwitchboardProvider } from '@switchboard/openfeature-provider';

const flagKey = process.env.SWITCHBOARD_FLAG ?? 'new-checkout';
const userId = process.env.SWITCHBOARD_USER ?? 'demo-user-07';

await OpenFeature.setProviderAndWait(new SwitchboardProvider({
  baseUrl: process.env.SWITCHBOARD_BASE_URL ?? 'http://127.0.0.1:3000',
  apiKey: process.env.SWITCHBOARD_API_KEY ?? '',
  timeoutMs: 1000,
}));

const details = await OpenFeature
  .getClient()
  .getBooleanDetails(flagKey, false, { targetingKey: userId });

console.log(JSON.stringify({
  service: 'service-b',
  transport: 'openfeature',
  flag: flagKey,
  user: userId,
  enabled: details.value,
  reason: details.reason,
  errorCode: details.errorCode ?? null,
}));

await OpenFeature.clearProviders();
