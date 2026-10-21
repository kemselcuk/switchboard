# @switchboard/openfeature-provider

OpenFeature server provider backed by the local Switchboard SDK.

This package is part of the Switchboard repository. It is **private and local
only**: it is not published to npm, and the `@switchboard` package name is
provisional for v2.0.

## Build and test

```bash
npm ci
npm run build
npm test --workspace @switchboard/openfeature-provider
```

Build `@switchboard/sdk` first, or run `npm run build` at the repository root.
`npm run demo:v2` builds both packages automatically.

## Install from a local tarball

From the repository root:

```bash
npm run build
npm pack --workspace @switchboard/sdk --workspace @switchboard/openfeature-provider
```

In the consuming project install **both** tarballs (the provider depends on the
SDK at the same version):

```bash
npm install /path/to/switchboard-sdk-2.0.0.tgz /path/to/switchboard-openfeature-provider-2.0.0.tgz
```

Both packages are `private` and not published to npm.

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
const theme = await client.getStringValue(
  'checkout-theme',
  'light',
  { targetingKey: 'user-123' },
);
```

## Behavior

- Resolves boolean, string, number, and object evaluations through the
  `@switchboard/sdk` typed getters.
- Bulk evaluation is **on by default**: the first evaluation for a context
  fetches all flags with one `POST /ofrep/v1/evaluate/flags` request and later
  evaluations for that context use the SDK cache. Pass `bulkEvaluation: false`
  to restore single-flag requests; omitting the option or passing `undefined`
  keeps bulk on.
- Background polling is **off** unless `pollingIntervalMs` is set; it is opt-in
  through the SDK options.
- `onClose()` calls `client.close()`, which clears polling timers and the
  per-context cache.
- SDK error codes map to OpenFeature codes: `FLAG_NOT_FOUND` and `TYPE_MISMATCH`
  keep their OpenFeature equivalents; authentication, storage, timeout,
  network, and general failures map to `GENERAL`.
- Wrong-typed values return the code default with `TYPE_MISMATCH`; number values
  must be finite and object values non-null objects.
- Unknown flags, invalid keys, storage failures, timeouts, and network errors
  resolve to the code default with an OpenFeature error code.

See the repository [README](../../README.md) for end-to-end setup.
