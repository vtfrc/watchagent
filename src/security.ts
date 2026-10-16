import ipaddr from 'ipaddr.js';

export class AppError extends Error {
  constructor(public code: string, message: string, public status = 400, public transient = false, public httpStatus?: number) {
    super(message);
  }
}

export function publicIp(value: string): boolean {
  try {
    const ip = ipaddr.process(value);
    if (ip.range() !== 'unicast') return false;
    // IPv6 outside the currently allocated global-unicast space is not a web target.
    if (ip.kind() === 'ipv6') return (ip as ipaddr.IPv6).match(ipaddr.IPv6.parse('2000::'), 3);
    return true;
  } catch { return false; }
}

export function validateUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new AppError('invalid_url', 'A valid HTTP(S) URL is required.'); }
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) || url.hash ||
      !host || host.endsWith('.') ||
      /(^|\.)(localhost|local|internal|home|lan|test|invalid|example|onion)$/.test(host) ||
      (ipaddr.isValid(host) ? !publicIp(host) : !host.includes('.'))) {
    throw new AppError('invalid_url', 'URL must use a public destination, with no credentials, fragment or unsupported port.');
  }
  return url;
}

// Fail closed if DNS cannot be checked. Validate all A and AAAA records, including CNAME results.
export async function assertPublicUrl(value: string): Promise<URL> {
  const url = validateUrl(value);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (ipaddr.isValid(host)) return url;
  const records = await Promise.all(['A', 'AAAA'].map(async type => {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(host)}&type=${type}`, {
      headers: { accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) throw new AppError('dns_error', 'DNS verification is unavailable.', 502, true);
    const body = await response.json() as { Status: number; Answer?: { type: number; data: string }[] };
    if (body.Status !== 0 && body.Status !== 3) throw new AppError('dns_error', 'DNS resolution failed.', 502, true);
    return (body.Answer ?? []).filter(r => r.type === 1 || r.type === 28).map(r => r.data);
  }));
  const ips = records.flat();
  if (!ips.length) throw new AppError('invalid_url', 'The destination has no public IP addresses.');
  if (ips.some(ip => !publicIp(ip))) throw new AppError('invalid_url', 'DNS resolves to a non-public network.');
  return url;
}

export async function safeFetch(value: string, init: RequestInit = {}): Promise<Response> {
  let url = value;
  for (let redirects = 0; redirects <= 5; redirects++) {
    await assertPublicUrl(url);
    const response = await fetch(url, { ...init, redirect: 'manual', signal: AbortSignal.timeout(15000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel();
      // Never forward webhook payloads, credentials or POSTs to a redirect.
      if (init.method && init.method !== 'GET') throw new AppError('unsafe_redirect', 'Redirects are not allowed for webhook requests.');
      if (!location) throw new AppError('unsafe_redirect', 'Redirect is missing a Location header.');
      url = new URL(location, url).href;
      continue;
    }
    return response;
  }
  throw new AppError('unsafe_redirect', 'Too many redirects.');
}

export function checkHttp(status: number): void {
  if (status >= 200 && status < 300) return;
  const transient = status === 408 || status === 425 || status === 429 || status >= 500;
  throw new AppError('upstream_http_error', `HTTP upstream ${status}`, 502, transient, status);
}

export async function readLimited(response: Response, maxBytes = 1_000_000): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let text = '', size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new AppError('content_too_large', `Content exceeds the ${maxBytes}-byte limit.`);
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { await reader.cancel(); }
}
