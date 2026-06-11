/**
 * Worker: DomainHealthChecker v2
 * + Wayback Machine validation + blacklist check + diode achat.
 */

import { buildStealthHeaders } from '../../lib/stealth.js';
import { isPolluted, addToBlacklist } from '../../lib/blacklist.js';
import { logError } from '../../lib/logger.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const domain = url.searchParams.get('domain');
    if (!domain) return new Response('Missing domain', { status: 400 });
    try {
      return Response.json(await checkHealth(domain, env));
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

  // Blacklist check rapide
  if (isPolluted(`https://${domain}`)) {
    await addToBlacklist(env, domain, 'auto-detected polluted content');
    return { domain, score: 0, blacklisted: true, checks: {}, ts: new Date().toISOString() };
  }

  // Checks en parallèle
  const [robotsR, sitemapR, redirectR, headersR, waybackR] = await Promise.allSettled([
    fetch(`${base}/robots.txt`, { headers, signal: AbortSignal.timeout(8000) }),
    fetch(`${base}/sitemap.xml`, { headers, signal: AbortSignal.timeout(8000) }),
    fetch(`http://${domain}`, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) }),
    fetch(base, { headers, signal: AbortSignal.timeout(8000) }),
    fetch(`https://web.archive.org/cdx/search/cdx?url=${domain}&output=json&limit=10&fl=timestamp,statuscode&filter=statuscode:200`, {
      signal: AbortSignal.timeout(10000),
    }),
  ]);

  // Robots.txt
  if (robotsR.status === 'fulfilled') {
    const r = robotsR.value;
    checks.robots = { status: r.status, ok: r.ok };
    if (r.ok) {
      const body = await r.text();
      checks.robots.disallowedPaths = (body.match(/Disallow: .+/g) || []).length;
    }
  } else { checks.robots = { error: robotsR.reason?.message }; }

  // Sitemap
  if (sitemapR.status === 'fulfilled') {
    checks.sitemap = { status: sitemapR.value.status, ok: sitemapR.value.ok };
  } else { checks.sitemap = { error: sitemapR.reason?.message }; }

  // HTTPS redirect
  if (redirectR.status === 'fulfilled') {
    const r = redirectR.value;
    checks.httpsRedirect = {
      status: r.status,
      redirectsToHttps: r.status >= 300 && r.status < 400 &&
        (r.headers.get('location') || '').startsWith('https'),
    };
  } else { checks.httpsRedirect = { error: redirectR.reason?.message }; }

  // Security headers
  if (headersR.status === 'fulfilled') {
    const h = headersR.value.headers;
    checks.securityHeaders = {
      hsts: !!h.get('strict-transport-security'),
      csp: !!h.get('content-security-policy'),
      xFrame: !!h.get('x-frame-options'),
    };
  } else { checks.securityHeaders = { error: headersR.reason?.message }; }

  // Wayback Machine — validation historique
  checks.wayback = { validated: false, snapshots: 0, oldestSnapshot: null };
  if (waybackR.status === 'fulfilled' && waybackR.value.ok) {
    try {
      const data = await waybackR.value.json();
      const rows = data.slice(1); // première ligne = headers
      checks.wayback.snapshots = rows.length;
      checks.wayback.validated = rows.length >= 2;
      if (rows.length) checks.wayback.oldestSnapshot = rows[rows.length - 1]?.[0];
    } catch { /* skip */ }
  }

  // Diode achat — verdict d'acquisition
  const score = computeScore(checks);
  checks.purchaseDiode = assessPurchase(score, checks);

  const result = { domain, score, checks, blacklisted: false, ts: new Date().toISOString() };
  await env.KV.put(`health:${domain}`, JSON.stringify(result));
  return result;
}

function computeScore(checks) {
  let score = 0;
  if (checks.robots?.ok) score += 15;
  if (checks.sitemap?.ok) score += 15;
  if (checks.httpsRedirect?.redirectsToHttps) score += 20;
  if (checks.securityHeaders?.hsts) score += 10;
  if (checks.securityHeaders?.csp) score += 10;
  if (checks.securityHeaders?.xFrame) score += 10;
  if (checks.wayback?.validated) score += 15;
  if (checks.wayback?.snapshots >= 5) score += 5;
  return score;
}

function assessPurchase(score, checks) {
  if (score >= 85 && checks.wayback?.validated) return { verdict: 'ACHETER', color: 'green', reason: 'Domaine établi, historique solide' };
  if (score >= 60) return { verdict: 'ANALYSER', color: 'yellow', reason: 'Bon score mais vérification manuelle recommandée' };
  if (!checks.wayback?.validated) return { verdict: 'RISQUE', color: 'orange', reason: 'Pas d\'historique Wayback — domaine récent ou supprimé' };
  return { verdict: 'ÉVITER', color: 'red', reason: `Score insuffisant (${score}/100)` };
}
