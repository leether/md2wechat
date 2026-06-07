# Task Card: Pipeline Self-Consistency After PR #7

## Objective

Restore the contract consistency between docs, render, preflight, bundle, orchestrator, and CI after PR #7 introduced `pre_image_missing` as an L1 gate.

## Boundary

- In scope:
  - Make render/preflight/orchestrator cover and image-check parameters explicit.
  - Stop orchestrator when preflight has unhandled L1 or agent failures.
  - Keep bundle and relay push inputs aligned, including cover image and crop arguments.
  - Reduce known preflight false positives for markdown counts and source-number checks.
  - Expand local and CI syntax coverage to the modified harness files.
  - Update README/SKILL/CHANGELOG-adjacent docs only where current behavior changes.
- Out of scope:
  - Real WeChat API publishing.
  - Real relay execution.
  - Implementing Dreamina or any image-generation CLI.
  - Reworking the renderer architecture or changing visual output style.
  - Committing, pushing, or opening another PR unless explicitly requested.

## Open Questions

1. Should `pre_image_missing` remain an L1 gate or be downgraded?
2. Should default render enforce publish-readiness or remain a render-only operation?
3. Should the current pass include relay/cover/crop fixes or only PR #7 changes?

Decision: Keep `pre_image_missing` as a pipeline L1 gate, but make render-stage enforcement explicit and reversible.

Reasoning:
- [A1] Markov blanket: render, preflight, bundle, and push need explicit parameter membranes; hidden cover requirements blur the boundary.
- [A2] Free energy: explicit `--cover`/`--skip-image-check` forwarding and hard stop on unhandled failures lower surprise and avoid late bundle failures.
- [A3] Autopoiesis: preserving the L1 rule keeps the failure-to-rule loop intact, but it must not create false self-reports from broken wiring.
- [A4] Godel pressure: no Dreamina implementation is added, so image generation remains replaceable and outside this repo's core.
- [A5] Thermodynamic arrow: the smallest reversible fix is contract wiring, parser hardening, false-positive reduction, and CI coverage, not a workflow rewrite.

Scope:
- In: parameter contracts, orchestration failure handling, bundle relay inputs, known false positives, CI/doc alignment.
- Out: live publishing, new external tool integration, broad renderer redesign.

Next Step:
1. Implement the plan below on a branch from `origin/main`.
2. Validate with: `npm run check`, full `node --check` over `scripts/` and `harness/`, render/preflight sample commands, orchestrator dry-run with explicit escape/cover paths.

Risk and Rollback:
- Risk: tightening orchestrator stopping behavior may expose existing sample/article deficiencies earlier.
- Rollback: revert this task card's code/doc changes; the branch is isolated from `main` until explicitly pushed.

# Plan

We are making the merged pipeline self-consistent rather than broadening scope. The approach is to keep PR #7's safety intent, wire its parameters through the existing entrypoints, stop on unhandled preflight failures, and update validation so CI can catch harness regressions.

## Scope
- In: render/preflight/orchestrator contracts, AutoHeal failure handling, bundle cover packaging, relay command generation, false-positive reduction, CI/docs.
- Out: real WeChat push, real relay run, Dreamina implementation, major renderer rewrite.

## Action items
[x] Add explicit render/preflight forwarding for cover and `--skip-image-check`.
[x] Refactor orchestrator preflight parsing and AutoHeal handling so unhandled L1/agent failures block before bundle.
[x] Add cover image packaging and crop forwarding to bundle/orchestrator relay commands.
[x] Replace fragile markdown card/table counting and HTML-number source verification with source-aware helpers.
[x] Expand `npm run check` and GitHub Lint workflow to cover harness scripts.
[x] Update README/SKILL/.env examples to match the new explicit image gate and relay options.
[x] Validate syntax, render-only success, preflight behavior, and orchestrator dry-run outcomes.
[x] Record residual risks that remain out of scope.

## Open questions
- None blocking; the five-axiom decision above resolves the implementation direction.

## Validation
- `npm run check`
- `git diff --check`
- `node scripts/create_wechat_draft.mjs --help`
- `node scripts/render_wechat_editorial.mjs --input examples/sample-article.md --output /tmp/md2wechat-verify-render.html --no-footer --no-preflight --lint-report-out /tmp/md2wechat-verify-lint.json`
- `node scripts/render_wechat_editorial.mjs --input examples/sample-article.md --output /tmp/md2wechat-verify-default.html --no-footer --lint-report-out /tmp/md2wechat-verify-default-lint.json` exits `3` as expected when preflight blocks missing images.
- `node harness/preflight.mjs --html /tmp/md2wechat-verify-render.html --md examples/sample-article.md --skip-image-check --json` exits `1` with only image path/size/CDN failures; card/table/source verification false positives are gone.
- `node scripts/orchestrator.mjs --input examples/sample-article.md --account MY_ACCOUNT --auto-fix --dry-run --skip-image-check` exits `3` before bundle because `/tmp/sample-image.png` is missing.
- Positive dry-run with `/tmp/md2wechat-positive.md`, `/tmp/md2wechat-positive-illustration.png`, and `/tmp/md2wechat-cover.png` exits `0`, enters bundle, and writes `/tmp/md2wechat-positive-bundle/bundle-manifest.json`.
- Positive non-`--auto-push` run exits `0` and generates a manual relay command without malformed `\scp`, `\ssh`, or `\  node` tokens.

## Residual Risks
- Real relay execution and real WeChat draft creation remain untested by design.
- Dreamina/image-generation CLI integration remains out of scope; the repo now enforces explicit image inputs or explicit escape.
- OCR-dependent cover placeholder detection still depends on local `tesseract` availability and quality.
