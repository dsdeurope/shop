/**
 * Worker: DomainHealthChecker
 * Vérifie la santé SEO d'un domaine (DNS, redirects, headers, robots.txt).
 */

import { buildStealthHeaders } from '../../lib/stealth.js';
import { logError } from '../../lib/logger.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const domain = url.searchParams.get('domain');
    if (!domain) return new Response('Missing domain', { status: 400 });

    try {
      const health = await checkHealth(domain, env);
      return Response.json(health);
    } catch (err) {
      await logError(env, 'domain-health', err.message, { domain });
      return Response.json({ error: err.message }, { status: 500 });
    }
  },
};

async function checkHealth(domain, env) {
  const headers = buildStealthHeaders();
  const base = `https://${domain}`;
  const checks = {};

  // Robots.txt
  try {
    const r = await fetch(`${base}/robots.txt`, { headers });
    checks.robots = { status: r.status, ok: r.ok };
    if (r.ok) {
      const body = await r.text();
      checks.robots.disallowedPaths = (body.match(/Disallow: .+/g) || []).length;
    }
  } catch (e) {
    checks.robots = { error: e.message };
  }

  // Sitemap
  try {
    const r = await fetch(`${base}/sitemap.xml`, { headers });
    checks.sitemap = { status: r.status, ok: r.ok };
  } catch (e) {
    checks.sitemap = { error: e.message };
  }

  // HTTPS + redirect
  try {
    const r = await fetch(`http://${domain}`, { headers, redirect: 'manual' });
    checks.httpsRedirect = {
      status: r.status,
      redirectsToHttps: r.status >= 300 && r.status < 400 &&
        (r.headers.get('location') || '').startsWith('https'),
    };
  } catch (e) {
    checks.httpsRedirect = { error: e.message };
  }

  // Security headers
  try {
    const r = await fetch(base, { headers });
    const h = r.headers;
    checks.securityHeaders = {
      hsts: !!h.get('strict-transport-security'),
      csp: !!h.get('content-security-policy'),
      xFrame: !!h.get('x-frame-options'),
    };
  } catch (e) {
    checks.securityHeaders = { error: e.message };
  }

  const score = computeScore(checks);
  const result = { domain, score, checks, ts: new Date().toISOString() };
  await env.KV.put(`health:${domain}`, JSON.stringify(result));
  return result;
}

function computeScore(checks) {
  let score = 0;
  if (checks.robots?.ok) score += 20;
  if (checks.sitemap?.ok) score += 20;
  if (checks.httpsRedirect?.redirectsToHttps) score += 30;
  if (checks.securityHeaders?.hsts) score += 10;
  if (checks.securityHeaders?.csp) score += 10;
  if (checks.securityHeaders?.xFrame) score += 10;
  return score;
}
