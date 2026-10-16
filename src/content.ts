import type { Env, WatchRow } from './types';
import { normalizeHtml } from './util';
import { assertPublicUrl, AppError, checkHttp, readLimited, safeFetch } from './security';

export function insufficientHtml(html: string, text: string): boolean {
  return text.length < 80 && (/<script\b/i.test(html) || /enable javascript|loading[.…]/i.test(text));
}

export async function fetchContent(env: Env, watch: WatchRow, onMode?: (mode: string) => Promise<void>): Promise<{ text: string; mode: string; status: number }> {
  if (env.LOCAL_FIXTURES === 'true' && new URL(watch.url).hostname === 'fixture.watchagent.dev') {
    const row = await env.DB.prepare('SELECT content FROM local_fixture WHERE id=1').first<{ content: string }>();
    if (!row) throw new AppError('fixture_missing', 'Configure /__dev/page before running a local fixture.');
    const shell = new URL(watch.url).pathname === '/shell';
    const mode = watch.use_browser || shell ? 'browser' : 'http';
    await onMode?.(mode);
    return { text: normalizeHtml(row.content), mode, status: 200 };
  }
  if (!watch.use_browser) {
    await onMode?.('http');
    const response = await safeFetch(watch.url, { headers: { accept: 'text/html,text/plain', 'user-agent': 'WatchAgent/0.2' } });
    checkHttp(response.status);
    const type = response.headers.get('content-type') ?? '';
    if (!/text\/|application\/xhtml\+xml/.test(type)) throw new AppError('unsupported_content', 'Only HTML and text pages are supported.');
    const raw = await readLimited(response);
    const text = type.includes('html') ? normalizeHtml(raw) : raw.replace(/\s+/g, ' ').trim();
    if (!type.includes('html') || !insufficientHtml(raw, text)) return { text, mode: 'http', status: response.status };
  }
  await onMode?.('browser');
  const url = await assertPublicUrl(watch.url);
  // Quick Actions do not support session guardrails. Constrain ALL browser requests
  // to this DNS-validated origin, including redirects and JS-triggered subrequests.
  // Cross-origin assets are deliberately blocked, rather than trusting arbitrary CDNs.
  const origin = url.origin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const response = await env.BROWSER.quickAction('markdown', {
    url: url.href,
    rejectRequestPattern: [`^(?!${origin}(?:/|$)).*`],
    gotoOptions: { waitUntil: 'networkidle2', timeout: 20000 }
  });
  checkHttp(response.status);
  const body = JSON.parse(await readLimited(response)) as { success?: boolean; result?: unknown };
  if (body.success === false || typeof body.result !== 'string') throw new AppError('browser_error', 'The page renderer did not return readable content.', 502, true);
  return { text: body.result.replace(/\s+/g, ' ').trim(), mode: 'browser', status: response.status };
}
