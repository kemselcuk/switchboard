# Task 087 — Package install verification and publish readiness

Follow-up to the portability research (F8). Read `AGENTS.md`,
`docs/EXPANSION_PLAN.md` section 16, and both package manifests first.

## Goal

Prove that `@switchboard/sdk` and `@switchboard/openfeature-provider` can be
installed and used outside the monorepo from packed tarballs, with correct
metadata and license files, while keeping the packages private until a release
decision. Actually publishing to npm needs maintainer credentials and is out of
scope for this task.

## Work

- Package metadata: `license`, `repository` (with directory), `engines`,
  `files` including `README.md` and `LICENSE`; keep `"private": true`.
- Add a LICENSE copy to each package.
- `npm run test:packages`:
  - builds both workspaces,
  - runs `npm pack` for both into a temporary directory,
  - asserts tarballs contain `dist/index.js`, `README.md`, `LICENSE` and no
    `src/`/`test/` files,
  - installs both tarballs into a temporary consumer project,
  - imports the SDK and provider, evaluates a flag against a local mock OFREP
    server, and fails on a wrong value,
  - prints tarball sizes, installed versions, and the evaluation result.
- README: install-from-tarball commands, provider dependency note, and the
  publish checklist (`private: false`, version bump, `npm publish --access
  public` for both, in order, with credentials supplied outside the repo).
- Package READMEs: tarball install example and the private/publish status.
- ADR-028: verified tarball distribution, publish deferred, semver/version
  coupling.

## Out of scope

Actual npm publish, registry credentials, CI release automation, provenance,
signing, GitHub Packages, and version bumps.

## Acceptance criteria

- `npm run test:packages` passes from a clean build and leaves no tarballs in
  the repo.
- Tarballs contain no source/tests and include license/readme.
- A temp consumer can import both packages and evaluate a boolean flag through
  the SDK and the provider.
- README, package READMEs, ADR-028, EVIDENCE, task status and plan updated.
- `npm test` and `test:workspaces` stay green; no new dependencies.

## Workflow

Implement directly; one independent review round if available.
