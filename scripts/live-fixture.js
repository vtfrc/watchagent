// Public, stateless test page. Deployed under a unique temporary Worker name by live.mjs.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
    const launched = Number(env.PRICE) < 50;
    const content = `<h1>Acme Cloud Pricing</h1><p>Plans for professional teams, billed monthly in US dollars. All plans include technical support, unlimited projects and a secure dashboard.</p><h2>Starter plan</h2><p>Starter: $${launched ? 85 : env.PRICE} per month.</p>${launched ? `<h2>Newly launched Lite plan</h2><p>Lite is now available for $${env.PRICE} per month.</p>` : ''}`;
    if (path === '/pricing') return new Response(content, { headers });
    if (path === '/shell') return new Response('<html><body><div id="root"></div><script src="/app.js"></script></body></html>', { headers });
    if (path === '/app.js') return new Response(`document.getElementById('root').innerHTML=${JSON.stringify(content)}`, {
      headers: { 'content-type': 'application/javascript', 'cache-control': 'no-store' }
    });
    if (path === '/hook' && request.method === 'POST') {
      const event = await request.json();
      return new Response(null, { status: event.id === request.headers.get('idempotency-key') ? 204 : 422 });
    }
    return new Response('Not found', { status: 404 });
  }
};
