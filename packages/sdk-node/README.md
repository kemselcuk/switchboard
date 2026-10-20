# @switchboard/sdk

Local Node.js/TypeScript client for the Switchboard OFREP API.

This package is part of the Switchboard repository. It is **private and local
only**: it is not published to npm, and the `@switchboard` package name is
provisional for v2.0.

## Build and test

```bash
npm ci
npm run build --workspace @switchboard/sdk
npm test --workspace @switchboard/sdk
```

The package entry point is `dist/index.js` with types in `dist/index.d.ts`, so
build before importing it. `npm run demo:v2` at the repository root builds it
automatically.

## Usage

```js
import { SwitchboardClient } from '@switchboard/sdk';

const client = new SwitchboardClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.SWITCHBOARD_API_KEY,
  timeoutMs: 1000,
});

const details = await client.getBooleanDetails(
  'new-checkout',
  false,
  { targetingKey: 'user-123' },
);

console.log(details.value, details.reason, details.errorCode);
```

`getBooleanValue(key, defaultValue, context)` returns only the boolean.

## Behavior

- Uses the single-flag OFREP endpoint.
- Unknown flag, invalid key, storage unavailability, timeout, and network
  errors return the supplied default value with `reason: "ERROR"` and an
  `errorCode` in `details`; they do not throw.
- v2.0 supports boolean flags only.
- `targetingKey` defaults to `"anonymous"` when omitted.

See the repository [README](../../README.md) for API keys, project setup, and
the full OFREP contract.
