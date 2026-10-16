import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Run the actual inline dashboard JS against a minimal DOM, without a UI framework.
const source = await readFile(new URL('../src/dashboard.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText;
const { APP_HTML } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
const script = /<script>([\s\S]*?)<\/script>/.exec(APP_HTML)[1];
test('dashboard uses English copy without infrastructure branding', () => {
  assert.match(APP_HTML, /<html lang="en">/);
  assert.match(APP_HTML, /Connect & refresh/);
  assert.match(APP_HTML, /Always render JavaScript/);
  assert.doesNotMatch(APP_HTML, /Cloudflare|Workers AI|Browser Run|Semantic monitoring/i);
  assert.doesNotMatch(APP_HTML, /Inserisci|Verifica|Nessun|Ultimo controllo|Avvisami|opzionale/);
});
test('theme automatically follows system preference without JS or saved settings', () => {
  assert.match(APP_HTML, /name="color-scheme" content="light dark"/);
  assert.match(APP_HTML, /@media\(prefers-color-scheme:dark\)/);
  assert.doesNotMatch(script, /localStorage|sessionStorage|matchMedia/);
});
test('light and dark palettes maintain readable text and lime button contrast', () => {
  const css = /<style>([\s\S]*?)<\/style>/.exec(APP_HTML)[1];
  const roots = [...css.matchAll(/:root\{([^}]*)\}/g)];
  const palettes = roots.map(([, block]) => Object.fromEntries([...block.matchAll(/(--[\w-]+):(#[0-9a-f]{3,6})(?=[;}])/gi)].map(m => [m[1], m[2]])));
  assert.equal(palettes.length, 2);
  const light = palettes[0], dark = { ...light, ...palettes[1] };
  const luminance = hex => {
    const value = hex.length === 4 ? hex.slice(1).split('').map(c => c + c).join('') : hex.slice(1);
    const rgb = [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  for (const [name, palette] of Object.entries({ light, dark })) {
    for (const [fg, bg] of [['--text', '--bg'], ['--text', '--surface'], ['--muted', '--surface'], ['--muted', '--empty'], ['--accent-ink', '--surface'], ['--accent-ink', '--soft'], ['--on-accent', '--accent'], ['--error', '--error-bg']]) {
      const a = luminance(palette[fg]), b = luminance(palette[bg]);
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(ratio >= 4.5, name + ': ' + fg + '/' + bg + ' contrast ' + ratio);
    }
  }
});
function setup(fetch, options = {}) {
  class Element {
    value = ''; textContent = ''; className = ''; disabled = false; children = [];
    replaceChildren() { this.children = []; this.textContent = ''; }
    append(child) { this.children.push(child); }
  }
  const nodes = Object.fromEntries(['key', 'message', 'load', 'auth-status', 'watches', 'events', 'create', 'watches-count', 'events-count', 'activity', 'report-controls', 'report-body'].map(id => [id, new Element()]));
  const document = { getElementById: id => nodes[id], createElement: tag => Object.assign(new Element(), { tagName: tag }) };
  vm.runInNewContext(script, { document, fetch, FormData, URL, URLSearchParams, setTimeout: options.setTimeout ?? setTimeout, confirm: options.confirm ?? (() => false) });
  return nodes;
}
test('valid key and empty data show confirmation and useful empty states', async () => {
  const calls = [];
  const nodes = setup(async (path, options) => { calls.push({ path, options }); return Response.json([]); });
  nodes.key.value = '  test-key  ';
  await nodes.load.onclick();
  assert.match(nodes['auth-status'].textContent, /API key verified/);
  assert.match(nodes.watches.textContent, /No watches yet/);
  assert.match(nodes.events.textContent, /No events yet/);
  assert.equal(nodes.load.disabled, false);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.headers.authorization, 'Bearer test-key');
});
test('invalid key displays the API error and clears stale results', async () => {
  const nodes = setup(async () => Response.json({ error: { message: 'Missing or invalid API key.' } }, { status: 401 }));
  nodes.key.value = 'bad';
  await nodes.load.onclick();
  assert.equal(nodes['auth-status'].className, 'error');
  assert.match(nodes['auth-status'].textContent, /invalid API key/);
  assert.match(nodes.watches.textContent, /could not be loaded/);
  assert.equal(nodes.load.disabled, false);
});
test('empty key fails visibly without making network requests', async () => {
  let calls = 0;
  const nodes = setup(async () => { calls++; return Response.json([]); });
  await nodes.load.onclick();
  assert.equal(calls, 0);
  assert.match(nodes['auth-status'].textContent, /Enter your API key/);
});
test('loading state is visible and disables repeated submissions', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const nodes = setup(async () => { await pending; return Response.json([]); });
  nodes.key.value = 'test-key';
  const loading = nodes.load.onclick();
  assert.equal(nodes.load.disabled, true);
  assert.match(nodes.load.textContent, /Loading/);
  assert.match(nodes['auth-status'].textContent, /Checking your API key/);
  release(); await loading;
  assert.equal(nodes.load.disabled, false);
});
test('network failures are visible and the button can be retried', async () => {
  const nodes = setup(async () => { throw Error('Network unavailable'); });
  nodes.key.value = 'test-key';
  await nodes.load.onclick();
  assert.match(nodes['auth-status'].textContent, /Unable to connect/);
  assert.equal(nodes.load.disabled, false);
});
test('watch results render with safe text and a run button', async () => {
  const nodes = setup(async path => Response.json(path === '/v1/watches' ? [{ id: 'watch_test', condition: '<script>untrusted</script>' }] : []));
  nodes.key.value = 'test-key';
  await nodes.load.onclick();
  assert.equal(nodes.watches.children.length, 1);
  const children = descendants(nodes.watches);
  assert.ok(children.some(node => node.tagName === 'p' && node.textContent === '<script>untrusted</script>'));
  assert.ok(children.some(node => node.tagName === 'button' && node.textContent === 'Run now'));
  const details = children.find(node => node.tagName === 'details');
  assert.ok(details);
  assert.notEqual(details.open, true);
  assert.equal(nodes['watches-count'].textContent, '1');
});
function descendants(node) { return [node, ...node.children.flatMap(descendants)]; }

test('event review sends a bounded note as JSON and updates displayed review safely', async () => {
  let saved;
  const nodes = setup(async (path, options) => {
    if (options.method === 'POST') { saved = { path, body: JSON.parse(options.body) }; return Response.json({ ...saved.body, updated_at: '2026-10-15T12:00:00Z' }); }
    return Response.json(path === '/v1/events' ? [{ id: 'evt_test', summary: 'A new plan', review: null }] : []);
  });
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  const note = descendants(nodes.events).find(n => n.tagName === 'textarea');
  assert.equal(note.maxLength, 1000); note.value = '<img src=x onerror=alert(1)>';
  await descendants(nodes.events).find(n => n.textContent === 'False alarm').onclick();
  assert.deepEqual(saved, { path: '/v1/event/evt_test/review', body: { verdict: 'false_positive', note: note.value } });
  assert.ok(descendants(nodes.events).some(n => n.textContent === 'Review: False alarm'));
  assert.ok(descendants(nodes.events).some(n => n.tagName === 'pre' && n.textContent.includes('false_positive')));
  assert.equal(nodes.message.textContent, 'Review saved.');
});
test('non-event feedback offers missed change and reports save errors without losing the note', async () => {
  const nodes = setup(async (path, options) => options.method === 'POST'
    ? Response.json({ error: { message: 'Review could not be saved.' } }, { status: 500 })
    : Response.json(path === '/v1/watches' ? [{ id: 'watch_test', status: 'active', latest_run: { id: 'run_test', status: 'not_matched' } }] : []));
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  const note = descendants(nodes.watches).find(n => n.tagName === 'textarea'); note.value = 'Independently observed a missed release.';
  const button = descendants(nodes.watches).find(n => n.textContent === 'Missed change'); await button.onclick();
  assert.equal(nodes.message.className, 'notice error'); assert.match(nodes.message.textContent, /could not be saved/);
  assert.equal(button.disabled, false); assert.match(note.value, /missed release/);
});
test('activity report loads lazily, shows complete aggregates and supports custom dates', async () => {
  const calls = [];
  const nodes = setup(async path => {
    calls.push(path);
    return Response.json(path.startsWith('/v1/report') ? { since: '2026-10-15T00:00:00Z', until: '2026-10-22T00:00:00Z', totals: { runs: 168, ai_calls: 3, event_false_positive: 1 }, watches: [], truncated: true } : []);
  });
  nodes.key.value = 'test-key'; await nodes.load.onclick(); assert.equal(calls.length, 2);
  nodes.activity.open = true; await nodes.activity.ontoggle();
  assert.ok(descendants(nodes['report-body']).some(n => /Runs: 168/.test(n.textContent)));
  assert.ok(descendants(nodes['report-body']).some(n => /Recorded AI calls: 3/.test(n.textContent)));
  assert.ok(descendants(nodes['report-body']).some(n => /totals are partial/.test(n.textContent)));
  const inputs = descendants(nodes['report-controls']).filter(n => n.tagName === 'input');
  inputs[0].value = '2026-10-15T00:00:00'; inputs[1].value = '2026-10-22T00:00:00';
  await descendants(nodes['report-controls']).find(n => n.textContent === 'Update report').onclick();
  const query = new URL(calls.at(-1), 'https://local');
  assert.equal(query.searchParams.get('since'), new Date(inputs[0].value).toISOString());
  assert.equal(query.searchParams.get('until'), new Date(inputs[1].value).toISOString());
});

test('a stale report response cannot overwrite a newer report', async () => {
  let release, reports = 0;
  const old = new Promise(resolve => { release = resolve; });
  const nodes = setup(async path => {
    if (!path.startsWith('/v1/report')) return Response.json([]);
    const number = ++reports; if (number === 1) await old;
    return Response.json({ totals: { runs: number }, watches: [] });
  });
  nodes.key.value = 'test-key'; nodes.activity.open = true;
  const first = nodes.activity.ontoggle(); await nodes.activity.ontoggle();
  release(); await first;
  assert.ok(descendants(nodes['report-body']).some(n => /Runs: 2/.test(n.textContent)));
});
test('history loads only when opened and renders failures', async () => {
  const calls = [];
  const nodes = setup(async path => {
    calls.push(path);
    return Response.json(path.endsWith('/runs') ? [{ status: 'failed', attempts: 1, error: 'HTTP upstream 404', ai_calls: 0 }] : path === '/v1/watches' ? [{ id: 'watch_test', status: 'active' }] : []);
  });
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  assert.equal(calls.some(path => path.endsWith('/runs')), false);
  const history = descendants(nodes.watches).find(node => node.tagName === 'details' && node.children[0]?.textContent === 'Run history');
  history.open = true; await history.ontoggle();
  assert.ok(descendants(history).some(node => node.textContent === 'HTTP upstream 404'));
  await history.ontoggle(); assert.equal(calls.filter(path => path.endsWith('/runs')).length, 1);
});
test('delete requires confirmation and refreshes after the mutation', async () => {
  const methods = [];
  const nodes = setup(async (path, options) => {
    methods.push(options.method || 'GET');
    return Response.json(path === '/v1/watches' ? [{ id: 'watch_test', status: 'active' }] : []);
  }, { confirm: () => true });
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  const button = descendants(nodes.watches).find(node => node.textContent === 'Delete'); await button.onclick();
  assert.ok(methods.includes('DELETE'));
  assert.equal(nodes.message.textContent, 'Watch deleted.');
});
test('manual-run polling is bounded instead of repeatedly calling forever', async () => {
  let polls = 0;
  const nodes = setup(async path => {
    if (path.endsWith('/runs')) { polls++; return Response.json([{ id: 'run_pending', status: 'running' }]); }
    return Response.json(path.endsWith('/run') ? { run_id: 'run_pending' } : path === '/v1/watches' ? [{ id: 'watch_test', status: 'active' }] : []);
  }, { setTimeout: resolve => resolve() });
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  await descendants(nodes.watches).find(node => node.textContent === 'Run now').onclick();
  assert.equal(polls, 60);
  assert.match(nodes.message.textContent, /still in progress/);
});

test('watch URLs are safe links, and dangerous protocols are never clickable', async () => {
  const nodes = setup(async path => Response.json(path === '/v1/watches' ? [
    { id: 'watch_public', url: 'https://example.com/pricing', condition: 'Price condition', status: 'active', interval_minutes: 60 },
    { id: 'watch_unsafe', url: 'javascript:alert(1)', condition: 'Untrusted URL', status: 'active', interval_minutes: 60 }
  ] : []));
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  const links = descendants(nodes.watches).filter(node => node.tagName === 'a');
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.com/pricing');
  assert.equal(links[0].rel, 'noopener noreferrer');
  assert.equal(links[0].target, '_blank');
});
test('event cards expose a readable summary, delivery state and confidence', async () => {
  const nodes = setup(async path => Response.json(path === '/v1/events' ? [
    { event_type: 'price_changed', summary: 'New plan $40', confidence: 0.95, delivery_status: 'delivered', created_at: '2026-10-14T12:00:00Z' }
  ] : []));
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  const children = descendants(nodes.events);
  assert.ok(children.some(node => node.textContent === 'New plan $40'));
  assert.ok(children.some(node => node.textContent === 'Confidence 95%'));
  assert.ok(children.some(node => node.textContent === 'Webhook delivered'));
  assert.ok(children.some(node => node.textContent === 'price_changed'));
  assert.equal(nodes['events-count'].textContent, '1');
});
test('watch run action polls completion, refreshes data and re-enables its button', async () => {
  const calls = [];
  const nodes = setup(async path => { calls.push(path); return Response.json(path.endsWith('/run') ? { run_id: 'run_test' } : path.endsWith('/runs') ? [{ id: 'run_test', status: 'unchanged' }] : path === '/v1/watches' ? [
    { id: 'watch_test', url: 'https://example.com', condition: 'Test condition', interval_minutes: 60, status: 'active' }
  ] : []); });
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  const button = descendants(nodes.watches).find(node => node.tagName === 'button');
  await button.onclick();
  assert.match(nodes.message.textContent, /Run finished: Unchanged/);
  assert.ok(calls.includes('/v1/watch/watch_test/runs'));
  assert.equal(calls.filter(path => path === '/v1/events').length, 2);
  assert.equal(button.disabled, false);
});
test('paused watch disables manual runs and offers resume', async () => {
  const mutations = [];
  const nodes = setup(async (path, options) => {
    if(options.method === 'PATCH') { mutations.push(JSON.parse(options.body)); return Response.json({ status: 'active' }); }
    return Response.json(path === '/v1/watches' ? [{ id: 'watch_test', status: 'paused', latest_run: { status: 'failed', attempts: 1, error: 'Cancelled: watch paused.' } }] : []);
  });
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  const children = descendants(nodes.watches);
  assert.equal(children.find(node => node.textContent === 'Run now').disabled, true);
  assert.ok(children.some(node => node.textContent === 'Cancelled: watch paused.'));
  await children.find(node => node.textContent === 'Resume').onclick();
  assert.deepEqual(mutations, [{ status: 'active' }]);
});
test('run diagnostics expose decision, source evidence and AI attempts safely', async () => {
  const nodes = setup(async path => Response.json(path === '/v1/watches' ? [{ id: 'watch_test', status: 'active', latest_run: {
    status: 'not_matched', attempts: 2, ai_calls: 2, fetch_ms: 30, ai_ms: 120,
    evaluation: { matched: false, summary: 'Not a launch', reason: 'Existing plan discounted', evidence: { before: '$90', after: '$40 <script>data</script>' } }
  } }] : []));
  nodes.key.value = 'test-key'; await nodes.load.onclick();
  const children = descendants(nodes.watches);
  assert.ok(children.some(node => node.textContent === 'Last run: No relevant change'));
  assert.ok(children.some(node => node.textContent === 'Existing plan discounted'));
  assert.ok(children.some(node => node.tagName === 'blockquote' && node.textContent === '$40 <script>data</script>'));
  assert.ok(children.some(node => node.textContent.includes('AI calls: 2')));
});
