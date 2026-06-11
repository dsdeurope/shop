/**
 * Worker: BacklinkHunter
 * Recherche d'opportunités de backlinks DoFollow qualifiés.
 */

import { buildFetchOptions } from '../../lib/stealth.js';
import { filterPolluted, scoreDomain } from '../../lib/seo.js';
import { logError } from '../../lib/logger.js';

export default {
  async fetch(request, env) {
    const { domain } = await request.json().catch(() => ({}));
    if (!domain) return new Response('Missing domain', { status: 400 });

    try {
      const backlinks = await huntBacklinks(domain, env);
      return Response.json(backlinks);
    } catch (err) {
      await logError(env, 'backlink-hunter', err.message, { domain });
      return Response.json({ error: err.message }, { status: 500 });
    }
  },

  async scheduled(event, env) {
    const queue = await getQueue(env);
    let errors = 0;

    for (const domain of queue) {
      try {
        await huntBacklinks(domain, env);
      } catch {
        errors++;
      }
    }

    const rate = queue.length ? errors / queue.length : 0;
    if (rate > 0.1) {
      await env.LOGS.put(`alert:backlink-hunter:${Date.now()}`, JSON.stringify({
        type: 'auto-pause', errorRate: rate, ts: new Date().toISOString(),
      }));
    }
  },
};

async function huntBacklinks(domain, env) {
  const { headers, cf } = buildFetchOptions(env.PROXY_LIST);

  const ccUrl = `https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.${domain}&output=json&limit=200`;
  const resp = await fetch(ccUrl, { headers, cf });
  const text = await resp.text();

  const seen = new Set();
  const opportunities = [];

  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      const normalized = normalizeUrl(entry.url);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      const score = scoreUrl(normalized);
      if (score > 30) opportunities.push({ url: normalized, score, ts: entry.timestamp });
    } catch { /* skip malformed */ }
  }

  const clean = filterPolluted(
    opportunities.map(o => o.url),
    ['casino', 'pharma', 'adult', 'gambling', 'porn', 'viagra'],
  ).map(url => opportunities.find(o => o.url === url)).filter(Boolean);

  clean.sort((a, b) => b.score - a.score);

  const result = { domain, total: clean.length, opportunities: clean.slice(0, 50), ts: new Date().toISOString() };
  await env.KV.put(`backlinks:${domain}`, JSON.stringify(result));
  return result;
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    // Supprime UTM, ref, tracking params
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
     'ref','_ga','gclid','fbclid','wvideo','affid','txnid'].forEach(p => u.searchParams.delete(p));
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch { return null; }
}

function scoreUrl(url) {
  let score = 40;
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.endsWith('.edu') || hostname.endsWith('.gov')) score += 40;
    else if (hostname.endsWith('.org')) score += 15;
    // Pages profondes = contenu réel, meilleur potentiel
    const depth = pathname.split('/').filter(Boolean).length;
    if (depth >= 2) score += 10;
    if (depth >= 3) score += 5;
    // Pénalité URLs avec trop de params résiduels
    if (url.includes('?') && url.split('?')[1].length > 30) score -= 10;
  } catch { return 0; }
  return score;
}

async function getQueue(env) {
  const raw = await env.KV.get('queue:backlink-hunter');
  return raw ? JSON.parse(raw) : [];
}
