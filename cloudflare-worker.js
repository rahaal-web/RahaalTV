// RahaL TV — Free Cloudflare Worker CORS Proxy (v2)
// Deploy for free at https://dash.cloudflare.com (Workers & Pages -> Create Worker)
// Free tier: 100,000 requests/day, zero sleep/cold-start, works permanently with GitHub Pages.

function isBlockedHost(hostname) {
  const h = (hostname || '').toLowerCase();
  if (
    h === 'localhost' ||
    h === '127.0.0.1' ||
    h === '0.0.0.0' ||
    h === '::1' ||
    h.endsWith('.local') ||
    h.startsWith('10.') ||
    h.startsWith('192.168.') ||
    h.startsWith('169.254.')
  ) {
    return true;
  }
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Expose-Headers':
    'X-Final-Url, X-Upstream-Status, X-Upstream-X-Frame-Options, X-Upstream-CSP, X-Proxy-Worker',
  'X-Proxy-Worker': 'rahaltv-v2',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const reqUrl = new URL(request.url);
    let target = (reqUrl.searchParams.get('url') || '').trim();
    const isPing = reqUrl.searchParams.has('ping');

    if (!target && request.method === 'POST') {
      try {
        const ct = request.headers.get('content-type') || '';
        if (ct.includes('application/json')) {
          const body = await request.json();
          if (body && typeof body.url === 'string') {
            target = body.url.trim();
          }
        }
      } catch {
        // Ignore invalid POST body
      }
    }

    if (!target && !isPing && env && env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }

    if (!target) {
      return new Response(
        JSON.stringify({
          ok: true,
          service: 'RahaL TV Proxy Worker',
          version: 2,
          usage: '?url=https://...',
          note: 'هذا رابط بروكسي السحب الخاص بـ RahaL TV. الصقه في لوحة الإدارة -> الإعدادات -> رابط بروكسي السحب.',
        }),
        {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
          },
        }
      );
    }

    let parsedTarget;
    try {
      parsedTarget = new URL(target);
    } catch {
      return new Response(JSON.stringify({ ok: false, error: 'Invalid target url' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    if (!['http:', 'https:'].includes(parsedTarget.protocol) || isBlockedHost(parsedTarget.hostname)) {
      return new Response(JSON.stringify({ ok: false, error: 'Blocked host or protocol' }), {
        status: 403,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }

    try {
      const upstream = await fetch(parsedTarget.toString(), {
        method: request.method === 'HEAD' ? 'HEAD' : 'GET',
        redirect: 'follow',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
          'Accept-Language': 'ar,en-US;q=0.9,en;q=0.8',
          'Upgrade-Insecure-Requests': '1',
          Referer: `${parsedTarget.origin}/`,
        },
      });

      const body = request.method === 'HEAD' ? null : await upstream.arrayBuffer();
      const contentType = upstream.headers.get('content-type') || 'text/html; charset=utf-8';
      const xFrame = upstream.headers.get('x-frame-options') || '';
      const csp = upstream.headers.get('content-security-policy') || '';
      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': contentType,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'public, max-age=120, stale-while-revalidate=300',
          'X-Final-Url': upstream.url || parsedTarget.toString(),
          'X-Upstream-Status': String(upstream.status),
          ...(xFrame ? { 'X-Upstream-X-Frame-Options': xFrame } : {}),
          ...(csp ? { 'X-Upstream-CSP': csp } : {}),
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ ok: false, error: String(err) }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
  },
};
