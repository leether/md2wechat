# Task Card: Govern 11 Friction Points From PR #8 Run

## Objective

Turn the 11 friction points observed during the PR #8 work into an explicit governance backlog with controls, owners/files, and acceptance criteria, so future agents can avoid repeating the same failure modes.

## Boundary

- In scope:
  - Record each friction point as a governable risk.
  - Define concrete controls and proof surfaces.
  - Mark which controls are already covered by PR #8 and which remain follow-up work.
  - Implement lightweight governance guards, tests, and documentation that close the friction loop.
- Out of scope:
  - Runtime publishing behavior changes beyond governance guards.
  - Cleaning unrelated untracked autopoiesis assets.
  - Creating a new release tag.
  - Changing branch protection settings.
  - Opening another PR unless explicitly requested.

## Friction Register

| # | Friction Point | Governance Control | Proof Surface | Status |
|---|---|---|---|---|
| 1 | Mixed worktree with unrelated untracked assets | Require explicit staging manifest; never use `git add -A` in mixed worktrees | `git status --short`, staged file list | Partially controlled by practice; needs documented checklist |
| 2 | PR #7 contract drift after `pre_image_missing` became L1 | Maintain render/preflight/orchestrator contract matrix for cover and image-check escape flags | `README.md`, `SKILL.md`, Task Card validation commands | Covered by PR #8 |
| 3 | AutoHeal had ambiguous bundle-safe vs hard-fail semantics | Keep a typed failure taxonomy: auto-fixable, bundle-safe, human-required, hard-fail | `scripts/orchestrator.mjs`, preflight report JSON | Covered by PR #8; taxonomy should be documented |
| 4 | Bundle/relay command promises diverged from implementation | Add command-generation smoke checks for bundle manifest, cover image, crop, `.env`, and manual command syntax | `/tmp` orchestrator smoke output, Task Card validation | Covered by PR #8; can be made automated |
| 5 | Generated self-evolution rules were too aggressive | Default generated rules to `observation_checks`, not L1 | `harness/push_rules.json`, `harness/code-generator.mjs` | Covered by PR #8 |
| 6 | Generated rules lacked quality gates | Generate companion tests and enforce generator contract tests in CI | `harness/test-code-generator-contract.mjs`, `harness/run-generated-check-tests.mjs` | Covered by PR #8 |
| 7 | Preflight false positives from raw markdown/HTML scanning | Prefer source-aware parsers/helpers; add fixture coverage around code fences, inline code, and visible text extraction | `harness/preflight.mjs`, `harness/agents/source-verification.mjs` | Covered by PR #8; fixture tests remain follow-up |
| 8 | CI did not cover harness changes | CI path filters and `npm run check` must cover `harness/**` and `package.json` | `.github/workflows/lint.yml`, `package.json` | Covered by PR #8 |
| 9 | Validation side effects rewrote `LESSONS_LEARNED.md` ordering | Add no-write validation mode or explicit cleanup protocol for self-reporting dry-runs | `scripts/orchestrator.mjs`, `harness/self_report.mjs`, `docs/LESSONS_LEARNED.md` diff | Follow-up needed |
| 10 | Release wording was ambiguous | Document release source of truth: `CHANGELOG.md` feeds tag-triggered GitHub Release; no separate Release doc exists | `.github/workflows/release.yml`, `CHANGELOG.md` | Partially controlled by PR body; docs follow-up useful |
| 11 | Merge policy blocked normal merge after green CI | Add merge decision ladder: normal merge, auto-merge if enabled, admin merge only with explicit authorization and green CI | PR notes, CI status, `gh pr view` evidence | Controlled by practice; needs documented checklist |

## Plan

[x] Add a publish checklist section to `SKILL.md` or `CONTRIBUTING.md` covering mixed-worktree staging, CI, PR, and merge decision ladder.
[x] Add a contract table for render/preflight/orchestrator/bundle/relay parameters and expected proof commands.
[x] Add fixture tests for card/table counting and source-visible-number extraction.
[x] Add an automated smoke or unit test for manual relay command generation.
[x] Add a no-write mode for self-report validation or document a mandatory cleanup protocol.
[x] Add a release-source-of-truth note explaining `CHANGELOG.md` and `.github/workflows/release.yml`.
[x] Keep generated rules in observation by default until a future promotion Task Card defines review gates.

## Acceptance Criteria

- Future PRs can show an explicit staged-file manifest when unrelated untracked files exist.
- Any L1 rule addition includes a contract update for all affected entrypoints.
- Generated checks cannot become L1 without a separate promotion record.
- CI proves harness syntax and generated-rule contracts.
- Validation commands either avoid writing governance files or document and clean their side effects.
- Release notes have a single source of truth.
- Merge path is recorded when branch policy requires non-default behavior.

## Current Evidence

- PR #8: `https://github.com/leether/md2wechat/pull/8`
- Merge commit: `ab9b9d3a5e53cd02c451dfa2fbf7141f35ba7eda`
- CI checks observed green: `privacy-check`, `validate`
- Local validation used before PR #8: `npm run check`, `./scripts/privacy-check.sh --full`, `git diff --cached --check`

## Implementation Evidence

- Publish checklist and merge decision ladder: `CONTRIBUTING.md`
- Release source of truth: `CONTRIBUTING.md`
- Parameter contract matrix and observation promotion policy: `SKILL.md`
- Preflight/source fixture tests: `harness/test-preflight-fixtures.mjs`
- Manual relay command contract test: `harness/test-orchestrator-command-contract.mjs`
- Self-report no-write contract: `scripts/orchestrator.mjs`, `harness/self_report.mjs`, `harness/test-self-report-no-write.mjs`
- CI/local check wiring: `package.json`, `.github/workflows/lint.yml`

## Validation

- `npm run check`
- `git diff --check`

## Residual Risks

- Existing untracked autopoiesis assets remain outside this governance scope.
- Branch protection settings remain repository configuration, not code.
- Auto-promotion from observation to L1 remains intentionally unsupported.
