/**
 * Worker: BacklinkHunter v2
 * Common Crawl + Wayback Machine + friction classification + storeSpot hash.
 */

import { buildFetchOptions } from '../../lib/stealth.js';
import { storeSpot } from '../../lib/hash.js';
import { filterClean, loadBlacklist } from '../../lib/blacklist.js';
import { logError } from '../../lib/logger.js';

export default {
  async fetch(request, env) {
    const { domain } = await request.json().catch(() => ({}));
    if (!domain) return new Response('Missing domain', { status: 400 });
    try {
      return Response.json(await huntBacklinks(domain, env));
    } catch (err) {
      await logError(env, 'backlink-hunter', err.message, { domain });
      return Response.json({ error: err.message }, { status: 500 });
    }
  },

  async scheduled(event, env) {
    const queue = JSON.parse(await env.KV.get('queue:backlink-hunter') || '[]');
    let errors = 0;
    for (const domain of queue) {
      try { await huntBacklinks(domain, env); } catch { errors++; }
    }
    if (queue.length && errors / queue.length > 0.1) {
      await env.LOGS.put(`alert:backlink-hunter:${Date.now()}`, JSON.stringify({
        type: 'auto-pause', errorRate: errors / queue.length, ts: new Date().toISOString(),
      }));
    }
  },
};

async function huntBacklinks(domain, env) {
  const { headers, cf } = buildFetchOptions(env.PROXY_LIST);
  const blacklist = await loadBlacklist(env);

  // Common Crawl
  const ccResp = await fetch(
    `https://index.commoncrawl.org/CC-MAIN-2026-21-index?url=*.${domain}&output=json&limit=200`,
    { headers, cf }
  );
  const ccText = await ccResp.text();

  // Wayback Machine CDX (vérifie l'ancienneté et l'existence réelle)
  const wbResp = await fetch(
    `https://web.archive.org/cdx/search/cdx?url=${domain}&output=json&limit=5&fl=timestamp,statuscode&filter=statuscode:200`,
    { headers }
  ).catch(() => null);
  const wbData = wbResp?.ok ? await wbResp.json().catch(() => []) : [];
  const waybackValidated = wbData.length > 1; // Au moins 2 snapshots = domaine établi

  const seen = new Set();
  const opportunities = [];

  for (const line of ccText.split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      const url = normalizeUrl(entry.url);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      if (!filterClean([url], blacklist).length) continue;

      const score = scoreUrl(url, waybackValidated);
      if (score > 30) {
        opportunities.push({
          url,
          score,
          domain,
          friction: 'inconnu',
          waybackValidated,
          ts: entry.timestamp,
        });
      }
    } catch { /* skip */ }
  }

  opportunities.sort((a, b) => b.score - a.score);
  const top = opportunities.slice(0, 50);

  // Stocke chaque spot avec hash anti-doublon
  let stored = 0;
  for (const spot of top) {
    const ok = await storeSpot(env, spot);
    if (ok) stored++;
  }

  const result = {
    domain,
    waybackValidated,
    total: opportunities.length,
    stored,
    opportunities: top,
    ts: new Date().toISOString(),
  };
  await env.KV.put(`backlinks:${domain}`, JSON.stringify(result));
  return result;
}

function normalizeUrl(raw) {
  try {
    const u = new URL(raw);
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content',
     'ref','_ga','gclid','fbclid','wvideo','affid','txnid'].forEach(p => u.searchParams.delete(p));
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch { return null; }
}

function scoreUrl(url, waybackBonus = false) {
  let score = 40;
  try {
    const { hostname, pathname } = new URL(url);
    if (hostname.endsWith('.edu') || hostname.endsWith('.gov')) score += 40;
    else if (hostname.endsWith('.org')) score += 15;
    const depth = pathname.split('/').filter(Boolean).length;
    if (depth >= 2) score += 10;
    if (depth >= 3) score += 5;
    if (waybackBonus) score += 10; // domaine établi et indexé
    if (url.includes('?') && url.split('?')[1].length > 30) score -= 10;
    // Bonus pages write-for-us / guest-post
    if (/write.?for.?us|guest.?post|contribut|submit.?article/i.test(url)) score += 20;
  } catch { return 0; }
  return score;
}
