# Semantic evaluation — 2026-10-15

Model: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`, temperature 0, max 600 output tokens. All inference ran on Workers AI. Each run used an authenticated temporary Worker, deleted afterwards. Expected labels were never sent to the model.

## Development corpus

`cases.json` contains 40 synthetic, labelled cases: 10 positives and 30 negatives. Coverage includes new plans versus discounts/renames, strict thresholds, currency and billing-period mismatches, stock variants, waitlists, preorders, old reviews, boilerplate and prompt injection.

This is a **development/regression corpus, not a held-out accuracy benchmark**. We inspected failures and changed the implementation against these examples. Passing does not imply perfect accuracy on new pages. Collect real-world and held-out examples before making reliability claims.

## Observed runs

| Implementation | Correct / 40 | False positives | Missed positives | Invalid/transport results |
|---|---:|---:|---:|---:|
| Initial structured classifier | 35 | 1 | 0 | 4 |
| Explicit strict-threshold prompt, ready harness | 38 | 2 | 0 | 0 |
| Prompt + evidence validation + conservative condition guards | 40 | 0 | 0 | 0 |

The initial four errors were harness deployment/secret propagation (HTML/unauthorized responses), not semantic decisions. The harness now checks authenticated readiness and reports HTTP versus inference errors separately. A valid incorrect classification is never retried in the benchmark.

The two semantic counterexamples were an existing-plan discount incorrectly treated as a launch, and `$50` treated as strictly below `$50`. Prompt changes alone did **not** reliably solve these cases. The final pipeline adds narrow deterministic guards for simple, explicit English launch and dollar price-threshold clauses. It declines to parse compound/unsupported clauses; those still rely on the model. This is not a general natural-language condition compiler.

## Final observed pipeline run

- Classifier source SHA-256: `b3830eb5f75859b44daa4848651f54bb730b4faa89c222df5ac4d9744cb76d0b`
- 10 true positives, 30 true negatives, zero false positives, zero missed positives.
- All emitted event types matched their labels.
- 40 harness requests / 40 inference attempts; no retries or invalid outputs.
- Precision 1.0 and recall 1.0 **on this run and this corpus only**.
- End-to-end case latency: p50 2,428 ms; p95 3,867 ms (excludes harness deployment).

Full timestamped reports remain in `.wrangler/evaluation-*.json`; `.wrangler/evaluation-latest.json` is the latest run. These files are ignored by Git. The report includes model name, source hash, expected/result per case, grounded quotes, attempts, errors and latency. Invalid positive results count as missed positives, not successes.

## Run it again

```bash
npm test                  # offline validation, business logic and corpus integrity
npm run eval:live          # all 40 cases, real Cloudflare usage and possible charges
EVAL_GROUP=launch npm run eval:live
EVAL_LIMIT=3 npm run eval:live
```

The runner reads `CLOUDFLARE_ACCOUNT_ID` from the environment or `.env`, and the model from `wrangler.jsonc` (override with `EVAL_MODEL`). Wrangler login or a suitable Cloudflare token is required. Do not put `eval:live` in normal CI builds: it deploys a temporary Worker, performs inference and can fail due to semantic regressions or provider errors. Exit code is nonzero unless all selected labels/types pass and cleanup succeeds.

## Limits

Verbatim citations establish source grounding, not that a model's interpretation is logically correct. Confidence is not calibrated probability. The production classifier still needs a real-page pilot and a larger held-out set, especially for compound conditions, non-English conditions, currencies, historical claims and ambiguous availability. Latency and cost vary with real page size and retries.
