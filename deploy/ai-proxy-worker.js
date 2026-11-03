// Cloudflare Worker: forwards Claude API requests from our server to api.anthropic.com.
// Needed because the Anthropic API does not accept requests from Russian IPs.
// Variables (Settings → Variables and Secrets):
//   ANTHROPIC_API_KEY — the real key from console.anthropic.com (type: Secret)
//   PROXY_SECRET      — a long random string, the same as AI_PROXY_SECRET on the server (type: Secret)
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/v1/')) return new Response('ok');
    // the SDK sends the key as x-api-key, or as a Bearer token when an auth token is configured
    const got = req.headers.get('x-api-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!env.PROXY_SECRET || env.PROXY_SECRET.length < 16 || got !== env.PROXY_SECRET) {
      return new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad proxy secret' } }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    const headers = new Headers();
    for (const [k, v] of req.headers) {
      if (k === 'content-type' || k.startsWith('anthropic-') || k === 'accept') headers.set(k, v);
    }
    headers.set('x-api-key', env.ANTHROPIC_API_KEY);
    return fetch('https://api.anthropic.com' + url.pathname + url.search, { method: req.method, headers, body: req.body });
  },
};
