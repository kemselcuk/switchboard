# Contracts

`ofrep-openapi.yaml` is the official OFREP 0.4.0 OpenAPI specification from
[open-feature/protocol](https://github.com/open-feature/protocol), licensed
under Apache-2.0. It is vendored here so contract tests can validate the
Switchboard implementation against the standard.

The Switchboard management API is documented in the main README and implemented
under `/api/v1`. Its contract tests live in `test/contract/`.

Do not edit the vendored OFREP file manually; update it from upstream when the
protocol version changes.
