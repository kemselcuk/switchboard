# @switchboard/openfeature-provider

OpenFeature server provider backed by the local Switchboard SDK.

This package is part of the Switchboard repository. It is **private and local
only**: it is not published to npm, and the `@switchboard` package name is
provisional for v2.0.

## Build and test

```bash
npm ci
npm run build --workspace @switchboard/openfeature-provider
npm test --workspace @switchboard/openfeature-provider
```

Build `@switchboard/sdk` first, or run `npm run build` at the repository root.
`npm run demo:v2` builds both packages automatically.

## Usage

```js
import { OpenFeature } from '@openfeature/server-sdk';
import { SwitchboardProvider } from '@switchboard/openfeature-provider';

await OpenFeature.setProviderAndWait(
  new SwitchboardProvider({
    baseUrl: 'http://localhost:3000',
    apiKey: process.env.SWITCHBOARD_API_KEY,
    timeoutMs: 1000,
  }),
);

const client = OpenFeature.getClient();
const enabled = await client.getBooleanValue(
  'new-checkout',
  false,
  { targetingKey: 'user-123' },
);
```

## Behavior

- Implements boolean evaluation through `@switchboard/sdk`.
- String, number, and object evaluation return the code default with
  `TYPE_MISMATCH`, because v2.0 supports boolean flags only.
- Unknown flags, invalid keys, storage failures, timeouts, and network errors
  resolve to the code default with an OpenFeature error code.

See the repository [README](../../README.md) for end-to-end setup.
