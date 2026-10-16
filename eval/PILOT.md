# Real-source pilot — October 2026

A small private pilot started on **15 October 2026 at 12:21 UTC**: 8 hourly watches on 7 public URLs, HTTP fetch only, no webhooks. Definitions are in [`pilot.json`](pilot.json) (`name` is a label, not an API field). The classifier and prompts were not changed during the pilot.

| Source | Condition (summary) | Value at baseline |
|---|---|---|
| [Linear](https://linear.app/pricing) | Basic per-user price, billed yearly | $10/user/month |
| [Loops](https://loops.so/pricing) | Starting price of the existing Growth plan | $49/month |
| [Loops](https://loops.so/pricing) | A genuinely new plan under $50/month | Growth already exists at $49, so it is not a launch |
| [Fathom](https://usefathom.com/pricing) | Monthly price for up to 100,000 pageviews | $15/month |
| [Cloudflare D1](https://developers.cloudflare.com/d1/platform/pricing/index.md) | Workers Paid rate per million rows written | $1.00/million |
| [kernel.org](https://www.kernel.org/) | Version labelled **stable** (not mainline/rc/longterm) | 7.2.11 |
| [Go](https://go.dev/VERSION?m=text) | Published version number, not build time | go1.27.2 |
| [OpenCode](https://github.com/anomalyco/opencode/releases/latest) | Latest stable release tag | v1.19.0 |

The two Loops watches are deliberately different: a Growth price cut should match the price watch, **not** the launch watch.

## Source selection

Several popular pricing pages exceeded the 12,000-character budget and were excluded rather than truncated. The Hacker News front page returned **HTTP 419 to the Worker**, so it was removed instead of attempting to bypass access controls.

## Initial observations

- 8/8 initial acquisitions succeeded: all baselines over HTTP, zero AI calls.
- 8 follow-up runs: 7 unchanged (no inference); Linear `not_matched` with one AI call.
- On Linear, only the document title moved from the start to the end of the text. An independent comparison of the stored texts confirmed everything else, including the price, was identical. Recorded as one verified correct non-event.

This is not an accuracy measurement. Unchanged hashes are not semantic decisions, and no real positive transition had been observed at the time of writing.

## Reviewing

Events are labelled in the dashboard as correct, false alarm or unsure. A change observed independently but not reported is labelled as a missed change on the relevant non-event run, with evidence in the note. The absence of events alone never counts as a correct negative or a miss. Aggregates come from `/v1/report`, not from the 100-row list endpoints.
