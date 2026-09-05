# OpenMinis-PC Development Rules

## Purpose

OpenMinis-PC is a Windows port of OpenMinis. The official Android and iOS repositories are the behavioral and interaction references for every ported feature.

## Source of truth

1. Read the latest `origin/main` before changing code.
2. Compare the relevant Windows implementation with the official Android/iOS implementation.
3. Preserve the official data flow and state model where Windows supports the same capability.
4. When Windows requires a platform-specific implementation, document the difference and verify equivalent behavior. Do not call a custom approximation 1:1 parity.

## Versioning

Use two version forms consistently:

- Internal package/crate/Tauri version: `1.13.X`.
- Public release tag, installer names, and user-facing release links: `v1.13.0.X`.

For every release, increment `X` by one and update these sources together:

- `src/windows/package.json`
- `src/windows/package-lock.json`
- `src/windows/src-tauri/Cargo.toml`
- `src/windows/src-tauri/Cargo.lock`
- `src/windows/src-tauri/tauri.conf.json`
- `.github/workflows/build-windows.yml`
- `README.md`
- `docs/devlogs/YYYY-MM-DD-v1.13.0.X.md`

The development log must state the internal version, public tag, changed behavior, official Android/iOS reference files, verification results, and known limitations.

## Documentation

- Keep one versioned development log per release under `docs/devlogs/`.
- Keep durable technical contracts under `docs/specs/`.
- Keep design proposals and implementation audits under `docs/` with an explicit status.
- Do not create ad hoc root-level bug logs, duplicate READMEs, or temporary Markdown files.
- Before deleting Markdown, search repository references and keep documents that describe build, licensing, contribution, APIs, protocols, or active designs.

## Implementation workflow

1. Inspect the latest Windows and official mobile code.
2. Write down the behavioral gap and acceptance criteria in the versioned development log.
3. Make the smallest coherent implementation across UI, state, persistence, and backend boundaries.
4. Add focused tests or deterministic validation for the changed behavior.
5. Run `git diff --check` and the relevant local build.
6. Verify the five internal version sources and the public release strings.
7. Commit code and documentation together with a Conventional Commit message.
8. Push to `main`, monitor GitHub Actions, inspect failed logs, and fix failures before reporting completion.
9. Verify the release tag and assets through GitHub after a release build.

## Release language

Use `OpenMinis Windows 体验版` for the product name. Keep `Windows 测试版 (Experimental)` only as a compatibility/disclaimer label where the UI or release metadata requires it. Do not mix version formats in one user-facing message.

## Completion standard

A change is complete only when the implementation, documentation, version metadata, local verification, and remote CI status agree. If one is not verified, report it as incomplete rather than inferred.
