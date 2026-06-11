/**
 * Worker: BacklinkHunter
 * Recherche d'opportunités de backlinks DoFollow qualifiés.
 */

import { rotateProxy, buildStealthHeaders } from '../../lib/stealth.js';
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
  const proxy = rotateProxy(env.PROXY_LIST);
  const headers = buildStealthHeaders();

  // Recherche via Common Crawl index (public, gratuit)
  const ccUrl = `https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*.${domain}&output=json&limit=100`;
  const resp = await fetch(ccUrl, { headers, cf: { resolveOverride: proxy } });
  const text = await resp.text();

  const opportunities = [];
  for (const line of text.split('\n').filter(Boolean)) {
    try {
      const entry = JSON.parse(line);
      const score = await scoreDomain(entry.url, env);
      if (score > 30) {
        opportunities.push({ url: entry.url, score, ts: entry.timestamp });
      }
    } catch { /* skip malformed */ }
  }

  const clean = filterPolluted(opportunities.map(o => o.url), [
    'casino', 'pharma', 'adult', 'gambling', 'porn', 'viagra',
  ]).map(url => opportunities.find(o => o.url === url)).filter(Boolean);

  clean.sort((a, b) => b.score - a.score);

  const result = { domain, opportunities: clean.slice(0, 50), ts: new Date().toISOString() };
  await env.KV.put(`backlinks:${domain}`, JSON.stringify(result));
  return result;
}

async function getQueue(env) {
  const raw = await env.KV.get('queue:backlink-hunter');
  return raw ? JSON.parse(raw) : [];
}
