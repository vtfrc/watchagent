# WatchAgent

**Reliable semantic events from web pages.** Describe a condition in plain English; WatchAgent checks the page on a schedule and emits an event only when a *new* change satisfies it, with verbatim before/after evidence.

```json
{
  "url": "https://competitor.com/pricing",
  "condition": "notify me if they launch a plan under $50",
  "interval_minutes": 60,
  "webhook": "https://your-service.com/events"
}
```

It runs entirely on your own Cloudflare account: Workers, D1, Queues, Workers AI, Browser Run and Cron Triggers. No external database, queue, LLM provider or server.

## Why

Page monitors tell you *that* something changed. The hard part is deciding whether the change matters, without a stream of false alarms. WatchAgent focuses on that decision and on being boring infrastructure:

- **Semantic, not textual.** An LLM compares old and new page text against your condition. A discount on an existing plan is not a "new plan launch"; `$50` is not "under $50".
- **Grounded.** Every event carries short quotes that are verified against the source text. Invented or missing evidence is rejected, not emitted.
- **Measured.** A labelled 40-case corpus and a live benchmark runner report false positives and negatives against the real model. See [eval/RESULTS.md](eval/RESULTS.md), including the failures it found.
- **Reliable.** Durable D1 outbox, leases and fencing tokens, atomic commits, deduplicated events and independent webhook retries.
- **Cheap.** Unchanged content is detected by hash and never reaches the model. HTTP first; a headless browser only when needed.

## How it works

```text
Cron (every 5 min) → due watches → D1 run/outbox → Queue
                                                    ↓
consumer → HTTP fetch → normalize → SHA-256 → unchanged: stop
             ↓ JS shell or use_browser=true
       Browser Run markdown Quick Action
                                                    ↓ hash changed
              Workers AI (JSON schema) → strict validation → evidence check
                                                    ↓
           one D1 batch: baseline + run result + optional event
                                                    ↓
                       Queue → webhook delivery with retries
```

- The first run stores a baseline and **never** emits an event, even if the condition is already true.
- Only `matched=true` with `confidence >= 0.8` and valid evidence becomes an event. Negative decisions are stored as run results.
- Event types: `plan_launched`, `price_changed`, `product_available`, `semantic_change`.
- `POST /v1/watch/:id/run` is asynchronous and returns `202` with a `run_id`.

### Reliability details

- A partial unique index allows one pending run per watch; concurrent manual runs coalesce.
- Consumers take a D1 lease with a fencing token. A stale consumer cannot overwrite a newer attempt, and pausing a watch revokes in-flight tokens.
- Event, new baseline and terminal run status commit in one atomic `DB.batch()`. A unique index on `events.run_id` prevents duplicates on queue redelivery.
- D1 is the outbox: if a queue send fails, the cron re-dispatches unsent or stalled runs. No Durable Objects or external locks.
- Transient failures (`408`, `425`, `429`, `5xx`, network, AI timeout, invalid AI output) retry up to **5 times** without advancing the baseline. Other failures are terminal for that run; the watch keeps its schedule.
- Webhooks retry up to **8 times** with their own backoff and never re-run the classifier. Delivery is **at-least-once**: deduplicate on the `Idempotency-Key: evt_...` header or `payload.id`.

## Quick start (local, no Cloudflare account)

Requires Node.js 22+ (tested with Node 24 and Wrangler 4.151).

```bash
npm install
cp .dev.vars.example .dev.vars
npm run db:local
npm run typecheck
npm test
npm run dev
```

Open `http://localhost:8787/`, enter `change-me-local` as the API key and press **Connect & refresh**.

Local mode uses a real local D1 and Queue, but **does not contact Workers AI or Browser Run**. `.dev.vars.example` enables a deterministic fixture for `fixture.watchagent.dev` only:

- `POST /__dev/page` sets the simulated page content.
- `https://fixture.watchagent.dev/pricing` simulates an HTTP page; `/shell` simulates a JavaScript shell that needs the browser.
- The fixture classifier only recognizes a transition to a price under $50. It is not the real model.
- Never enable `LOCAL_FIXTURES` in production.

In a second terminal, `npm run test:smoke` drives the real local Queue end to end: auth, SSRF checks, baseline, irrelevant change, matching event, no duplicates, browser fixture, cron and cleanup.

<details>
<summary>Manual walkthrough with curl</summary>

```bash
export API_KEY=change-me-local BASE=http://localhost:8787

curl -sS "$BASE/__dev/page" -X POST -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' -d '{"content":"<h1>Pricing</h1><p>Plan $90</p>"}'

curl -sS "$BASE/v1/watch" -X POST -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{"url":"https://fixture.watchagent.dev/pricing","condition":"notify me if they launch a plan under $50"}'

export WATCH_ID=watch_REPLACE_ME
curl -sS "$BASE/v1/watch/$WATCH_ID/run" -X POST -H "Authorization: Bearer $API_KEY"   # baseline

curl -sS "$BASE/__dev/page" -X POST -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' -d '{"content":"<h1>Pricing</h1><p>New plan $40</p>"}'

curl -sS "$BASE/v1/watch/$WATCH_ID/run" -X POST -H "Authorization: Bearer $API_KEY"   # event
sleep 3
curl -sS "$BASE/v1/watch/$WATCH_ID/events" -H "Authorization: Bearer $API_KEY"

curl -sS "$BASE/__scheduled?cron=*/5+*+*+*+*"   # trigger the local cron
```

</details>

## Deploy to your Cloudflare account

```bash
npx wrangler login
echo "CLOUDFLARE_ACCOUNT_ID=<your-account-id>" > .env   # gitignored; read by Wrangler and the scripts
npx wrangler d1 create watchagent                       # put the returned database_id in wrangler.jsonc
npx wrangler queues create watchagent-jobs
npx wrangler queues create watchagent-dlq
npm run db:remote
npx wrangler secret put API_KEY                          # use a long random value
npm run deploy
```

Workers AI and Browser Run usage is billed by Cloudflare. Updates are `npm run db:remote && npm run deploy`. Back up D1 (`wrangler d1 export`) before applying migrations to existing data; all migrations after `0002` are additive.

### Real AI and browser checks

Browser Run Quick Actions cannot be emulated locally.

- `npm run dev:cloudflare` keeps D1 and the Queue local but uses real Workers AI and Browser Run. Set `LOCAL_FIXTURES=false` first.
- `npm run test:live` deploys a temporary public fixture Worker, exercises HTTP, browser opt-in and fallback, an irrelevant change, a real match, duplicate prevention, webhooks and HTTP errors, then deletes it.
- `npm run test:production` runs the same checks against a deployed instance described in `.env.production` (`WATCHAGENT_URL`, `WATCHAGENT_API_KEY`) and waits for a natural cron run.

These commands create real resources and incur usage. Keep them out of normal CI.

## Evaluation

```bash
npm run eval:live                    # all 40 cases against the real model
EVAL_GROUP=launch npm run eval:live  # one group
EVAL_LIMIT=3 npm run eval:live       # a subset
```

The runner deploys an authenticated temporary Worker running **the same classifier and guards as production**, never sends expected labels to the model, retries transport errors but never a valid wrong answer, and deletes the Worker afterwards. Reports include precision, recall, false positives and negatives, wrong event types, invalid outputs, latency and inference attempts.

The latest run passed 40/40. The first runs did not: an existing-plan discount was accepted as a launch, and `$50` was treated as below `$50`. Prompt changes alone did not reliably fix them, so narrow deterministic guards were added for simple English launch and dollar-threshold conditions. **This is a development corpus, not a held-out benchmark or an accuracy guarantee.** Details: [eval/RESULTS.md](eval/RESULTS.md). A small real-world pilot is described in [eval/PILOT.md](eval/PILOT.md).

## Dashboard

A dependency-free page at `/` with automatic light/dark theme. The API key stays in tab memory and is never stored by the browser.

- Watches with the latest run: outcome, error or decision reason, evidence, attempts, AI calls and timings.
- **Run now** with automatic polling, run history, **Pause/Resume** (keeps the baseline, cancels pending work) and **Delete**.
- Events with evidence, delivery status and human feedback: **Correct / False alarm / Unsure**. Non-event runs can be marked **Missed change**.
- **Activity report**: complete D1 aggregates for a time window, beyond the 100-row list limits.

## API

All endpoints except `/` and `/health` require `Authorization: Bearer <API_KEY>`.

| Method | Endpoint | Description |
|---|---|---|
| POST | `/v1/watch` | Create a watch (`201`) |
| GET | `/v1/watches` | Latest 100 watches with `latest_run` |
| GET | `/v1/watch/:id` | Watch metadata, without baseline text |
| PATCH | `/v1/watch/:id` | `{"status":"paused"}` or `{"status":"active"}` |
| DELETE | `/v1/watch/:id` | Delete the watch, its runs, events and reviews |
| POST | `/v1/watch/:id/run` | Queue a run (`202 {"run_id":"run_...","status":"queued"}`) |
| GET | `/v1/watch/:id/runs` | Latest 100 runs with diagnostics |
| GET | `/v1/watch/:id/events` | Latest 100 events |
| GET | `/v1/events?watch_id=...` | Latest 100 events, optional filter |
| POST | `/v1/event/:id/review` | `{"verdict":"correct\|false_positive\|unsure","note":"..."}` |
| POST | `/v1/run/:id/review` | `{"verdict":"correct\|false_negative\|unsure","note":"..."}` |
| GET | `/v1/report?since=...&until=...` | Aggregates for `[since, until)`, max 31 days, default last 7 |
| GET | `/health` | Liveness, no auth |

Create payloads are strictly validated: unknown fields are rejected, `condition` is 3–1000 characters, `interval_minutes` is an integer from 5 to 10080 (default 60), `use_browser` defaults to `false`, and `webhook` is optional (`webhook_url` is accepted as an alias, not both).

Event / webhook payload:

```json
{
  "id": "evt_...",
  "watch_id": "watch_...",
  "run_id": "run_...",
  "url": "https://competitor.com/pricing",
  "condition": "notify me if they launch a plan under $50",
  "created_at": "2026-10-14T12:00:00.000Z",
  "old_hash": "...",
  "new_hash": "...",
  "matched": true,
  "confidence": 0.95,
  "event_type": "plan_launched",
  "summary": "A new $40 plan is available.",
  "reason": "The Lite plan was introduced in the new page.",
  "evidence": { "before": null, "after": "New Lite plan: $40 per month." }
}
```

Errors share one shape: `{"error":{"code":"invalid_url","message":"..."}}`.

## Security

- Only public HTTP(S) URLs on ports 80/443, without credentials or fragments. Private, loopback, link-local, CGNAT, multicast, reserved and documentation ranges are blocked for IPv4 and IPv6, including mapped addresses, plus local and special-use hostnames.
- Every A/AAAA answer must be public, checked at creation **and before every request**. DNS failures fail closed.
- Redirects are followed manually and revalidated (max 5). Webhooks never follow redirects.
- The browser may only load the validated origin; cross-origin requests are blocked, so pages relying on external CDNs may not render.
- Limits: 1 MB responses, 12,000 normalized characters. Larger pages fail explicitly instead of being classified on truncated text.
- AI output is validated without coercion. Page text is treated as untrusted data in the prompt; this reduces but does not eliminate prompt injection.
- **Known residual risk:** DNS checks and connections are not atomic, so DNS rebinding (TOCTOU) remains possible. Do not treat this as network isolation.

## Limitations

Single API key, no multi-tenancy, no quotas or rate limiting, no webhook signatures, no automatic retention, and no accuracy measurement on an independent real-world corpus. Pages over 12,000 characters, which includes many large pricing pages, are rejected rather than partially analysed.

## Development

- `npm test`: Workers-runtime tests with a real local D1 and migrations, mocked HTTP, AI and browser (concurrency, fencing, retries, deduplication, auth, schema, SSRF, reviews, reports), plus dashboard tests that execute the inline UI script.
- `npm run typecheck`, `npm run build` (Wrangler dry run).

Cloudflare references: [Queues API](https://developers.cloudflare.com/queues/configuration/javascript-apis/), [`global_fetch_strictly_public`](https://developers.cloudflare.com/workers/configuration/compatibility-flags/#global-fetch-strictly-public), [Browser Run Quick Actions](https://developers.cloudflare.com/browser-run/quick-actions/), [Workers AI JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/), [Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/configuration/).

## License

[MIT](LICENSE)
