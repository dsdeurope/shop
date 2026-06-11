/**
 * Worker: Radar
 * Découverte de domaines & opportunités SEO via crawl furtif.
 */

import { rotateProxy, buildStealthHeaders } from '../../lib/stealth.js';
import { filterPolluted, extractEntities } from '../../lib/seo.js';
import { logError } from '../../lib/logger.js';

const EXCLUDE_CATEGORIES = ['casino', 'pharma', 'adult', 'gambling', 'porn', 'viagra'];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const target = url.searchParams.get('target');
    if (!target) return new Response('Missing target', { status: 400 });

    try {
      const result = await discoverOpportunities(target, env);
      return Response.json(result);
    } catch (err) {
      await logError(env, 'radar', err.message, { target });
      return Response.json({ error: err.message }, { status: 500 });
    }
  },

  async scheduled(event, env, ctx) {
    const targets = await getTargetQueue(env);
    let errors = 0;

    for (const target of targets) {
      try {
        await discoverOpportunities(target, env);
      } catch {
        errors++;
      }
    }

    const errorRate = targets.length ? errors / targets.length : 0;
    if (errorRate > 0.1) {
      await env.LOGS.put(`alert:radar:${Date.now()}`, JSON.stringify({
        type: 'auto-pause',
        errorRate,
        ts: new Date().toISOString(),
      }));
    }
  },
};

async function discoverOpportunities(target, env) {
  const proxy = rotateProxy(env.PROXY_LIST);
  const headers = buildStealthHeaders();

  const resp = await fetch(`https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`, {
    headers,
    cf: { resolveOverride: proxy },
  });

  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status}`);
  const html = await resp.text();

  const links = extractDoFollowLinks(html, target);
  const clean = filterPolluted(links, EXCLUDE_CATEGORIES);
  const entities = extractEntities(html);

  const result = { target, links: clean, entities, ts: new Date().toISOString() };
  await env.KV.put(`radar:${target}`, JSON.stringify(result));
  return result;
}

function extractDoFollowLinks(html, base) {
  const links = [];
  const re = /<a\s[^>]*href="(https?:\/\/[^"]+)"[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const nofollow = m[0].includes('rel="nofollow"') || m[0].includes("rel='nofollow'");
    if (!nofollow) links.push(m[1]);
  }
  return [...new Set(links)];
}

async function getTargetQueue(env) {
  const raw = await env.KV.get('queue:radar');
  return raw ? JSON.parse(raw) : [];
}
