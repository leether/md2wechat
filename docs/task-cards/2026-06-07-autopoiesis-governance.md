# Task Card: Governed Autopoiesis Rule Evolution

## Objective

Make generated autopoiesis rules safe by default: every generated rule must have a companion test, new generated rules must enter an isolated observation layer instead of L1, and every evolution must leave an audit record plus rollback snapshot.

## Boundary

- In scope:
  - `harness/code-generator.mjs` rule generation, registration, tests, audit, and rollback snapshot handling.
  - `harness/preflight.mjs` loading and reporting of generated observation checks.
  - `harness/self_report.mjs` integration with the governed generation output.
  - Local and CI syntax/test coverage for generated rule tests.
  - README/SKILL/CHANGELOG updates for the changed self-evolution contract.
- Out of scope:
  - Demoting existing hand-curated L1 rules.
  - Real WeChat publishing or relay execution.
  - Adding LLM-based semantic review.
  - Making generated scaffold rules production-enforced automatically.
  - Committing, pushing, or opening a PR unless explicitly requested.

## Plan

[x] Add observation-layer registration for newly generated checks.
[x] Generate companion tests beside generated checks and add a runner.
[x] Write evolution audit JSON and rollback snapshot for every persisted rule evolution.
[x] Update preflight to run observation checks and report them without blocking.
[x] Wire generated-rule tests into `npm run check` and CI lint.
[x] Update README/SKILL/CHANGELOG to describe the governed self-evolution model.
[x] Validate syntax, generated test runner, sample rule generation, and observation behavior.

## Non-Goals

- This pass does not claim generated rules are production-ready.
- This pass does not auto-promote observation checks to L1.
- This pass does not remove manual review from the evolution process.

## Residual Risk To Track

- Generated checks are still template-based and may be weak; the safety control is isolation plus test/audit, not perfect inference.

## Validation

- `npm run check`
- `git diff --check`
- `node harness/test-code-generator-contract.mjs`
- Temp persist smoke in `/tmp/md2wechat-codegen-persist`: generated check, companion test, `docs/evolution-audit/*.json`, and `harness/evolution-snapshots/*/rollback.json`; generated companion test executed with `node`.
- Temp observation smoke with a real generated check loaded from `/tmp` rules/checks: preflight reported the observation failure while returning `ok: true`, `l1Failures: []`, and `observation.block_on_fail: false`.

## Residual Risks

- Observation rules are not automatically promoted; promotion still needs a human review path.
- Generated semantic/image checks remain scaffolds until a reviewer adds concrete logic.
- Rollback snapshots capture file state before generation, but automated rollback execution is intentionally out of scope.
