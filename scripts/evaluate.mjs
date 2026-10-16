import { readFile, writeFile, mkdtemp, mkdir, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

// Manual benchmark only: creates an authenticated, temporary Workers AI harness.
// Never sends expected labels to the classifier and never retries a valid wrong answer.
const configText = await readFile('wrangler.jsonc', 'utf8');
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const model = process.env.EVAL_MODEL ?? /"AI_MODEL"\s*:\s*"([^"]+)"/.exec(configText)?.[1];
if (!account || !model) throw Error('Set CLOUDFLARE_ACCOUNT_ID (environment or .env) and AI_MODEL in wrangler.jsonc.');
let cases = JSON.parse(await readFile('eval/cases.json', 'utf8'));
if (process.env.EVAL_GROUP) cases = cases.filter(c => c.group === process.env.EVAL_GROUP);
if (process.env.EVAL_LIMIT) cases = cases.slice(0, Number(process.env.EVAL_LIMIT));
if (!cases.length) throw Error('No selected cases.');
const directory = await mkdtemp(join(tmpdir(), 'watchagent-eval-'));
const config = join(directory, 'wrangler.json');
const name = 'watchagent-eval-' + Date.now().toString(36);
const key = randomBytes(32).toString('hex');
const report = { started_at: new Date().toISOString(), model, account_id: account,
  classifier_sha256: createHash('sha256').update(await readFile('src/evaluation.ts')).digest('hex'), cases: [] };
let attemptedDeployment = false;
async function cli(args, input) {
  const child = spawn(resolve('node_modules/.bin/wrangler'), args, { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; process.stdout.write(data); });
  child.stderr.on('data', data => process.stderr.write(data));
  child.stdin.end(input);
  await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('Wrangler exit ' + code))); });
  return output;
}
try {
  await writeFile(config, JSON.stringify({ name, account_id: account, main: resolve('eval/worker.ts'), compatibility_date: '2026-10-14',
    workers_dev: true, preview_urls: false, ai: { binding: 'AI' }, vars: { AI_MODEL: model } }));
  attemptedDeployment = true;
  const output = await cli(['deploy', '--config', config]);
  const url = /https:\/\/[a-z0-9.-]+\.workers\.dev/.exec(output)?.[0];
  if (!url) throw Error('Harness URL not found.');
  await cli(['secret', 'put', 'EVAL_KEY', '--config', config], key + '\n');
  // Allow both the deployment and secret to reach the edge before starting inference.
  let ready = 0;
  for (let i = 0; i < 60 && ready < 3; i++) {
    try { const check = await fetch(url, { headers: { authorization: 'Bearer ' + key } }); ready = check.status === 405 ? ready + 1 : 0; }
    catch { ready = 0; }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (ready < 3) throw Error('Evaluation harness/secret did not become ready.');
  await new Promise(resolve => setTimeout(resolve, 20000));
  for (const c of cases) {
    let result = null; const errors = []; const start = Date.now(); let attempts = 0, inferenceAttempts = 0;
    for (let i = 0; i < 2; i++) {
      attempts++;
      try {
        const response = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' },
          body: JSON.stringify({ condition: c.condition, old_page: c.old_page, new_page: c.new_page }), signal: AbortSignal.timeout(100000) });
        const text = await response.text();
        let body;
        try { body = JSON.parse(text); } catch { throw Error('Harness HTTP ' + response.status + ': non-JSON response'); }
        if (typeof body.latency_ms === 'number') inferenceAttempts++;
        if (!response.ok) throw Error('Harness HTTP ' + response.status + ': ' + (body.error ?? 'request failed'));
        result = body; break;
      } catch (error) { errors.push(String(error)); if (i === 0) await new Promise(resolve => setTimeout(resolve, 5000)); }
    }
    const correct = result !== null && result.emitted === c.expected.matched && (!c.expected.matched || result.evaluation.event_type === c.expected.event_type);
    report.cases.push({ id: c.id, group: c.group, expected: c.expected, result, correct, errors, attempts, inference_attempts: inferenceAttempts, latency_ms: Date.now() - start });
    console.log(`${correct ? 'PASS' : 'FAIL'} ${c.id}: expected=${c.expected.matched} emitted=${result?.emitted ?? 'ERROR'} type=${result?.evaluation.event_type ?? '-'} (${Date.now() - start} ms)`);
  }
  const rows = report.cases, tp = rows.filter(r => r.expected.matched && r.result?.emitted).length;
  const fp = rows.filter(r => !r.expected.matched && r.result?.emitted).length;
  const positives = rows.filter(r => r.expected.matched).length;
  const latencies = rows.map(r => r.latency_ms).sort((a, b) => a - b);
  report.metrics = { total: rows.length, correct: rows.filter(r => r.correct).length, true_positives: tp, false_positives: fp,
    false_negatives: positives - tp, invalid_results: rows.filter(r => !r.result).length,
    wrong_event_type: rows.filter(r => r.expected.matched && r.result?.emitted && r.result.evaluation.event_type !== r.expected.event_type).length,
    precision: tp + fp ? tp / (tp + fp) : null, recall: positives ? tp / positives : null,
    harness_requests: rows.reduce((n, r) => n + r.attempts, 0), inference_attempts: rows.reduce((n, r) => n + r.inference_attempts, 0), latency_p50_ms: latencies[Math.floor(latencies.length * .5)],
    latency_p95_ms: latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * .95) - 1)] };
  console.log(JSON.stringify(report.metrics, null, 2));
  if (report.metrics.correct !== rows.length) process.exitCode = 1;
} finally {
  if (attemptedDeployment) {
    try { await cli(['delete', '--config', config, '--force']); report.harness_deleted = true; }
    catch (error) { report.harness_deleted = false; console.error('Cleanup failed for ' + name, String(error)); process.exitCode = 1; }
  }
  report.finished_at = new Date().toISOString();
  await mkdir('.wrangler', { recursive: true });
  const stamp = report.started_at.replace(/[:.]/g, '-');
  await writeFile('.wrangler/evaluation-' + stamp + '.json', JSON.stringify(report, null, 2));
  await writeFile('.wrangler/evaluation-latest.json', JSON.stringify(report, null, 2));
  await rm(directory, { recursive: true, force: true });
  console.log('Report: .wrangler/evaluation-latest.json');
}
