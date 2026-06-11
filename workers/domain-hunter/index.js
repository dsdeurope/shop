/**
 * Worker: DomainHunter
 * Chasse aux domaines disponibles/expirés via footprints SEO.
 * Pipeline: footprint → dorks → check DNS → parking → Wayback → score
 */

import { buildFetchOptions, buildStealthHeaders } from '../../lib/stealth.js';
import { extractFullFootprint, matchFootprint, isParked, isParkingIp, NICHE_FOOTPRINTS } from '../../lib/footprint-patterns.js';
import { isPolluted, addToBlacklist } from '../../lib/blacklist.js';
import { logError, logInfo } from '../../lib/logger.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,OPTIONS',
  'Content-Type': 'application/json',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const url = new URL(request.url);
    const action = url.searchParams.get('action') || 'hunt';
    const niche = url.searchParams.get('niche') || 'seo_blog';
    const leaderUrl = url.searchParams.get('leader');

    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), { status, headers: CORS });

    try {
      if (action === 'analyze' && leaderUrl) return json(await analyzeLeader(leaderUrl, niche, env));
      if (action === 'report') return json(await getReport(env));
      return json(await huntDomains(niche, env));
    } catch (err) {
      await logError(env, 'domain-hunter', err.message, { action, niche });
      return json({ error: err.message }, 500);
    }
  },

  async scheduled(event, env) {
    for (const niche of Object.keys(NICHE_FOOTPRINTS)) {
      try { await huntDomains(niche, env); } catch { /* continue */ }
    }
  },
};

// ─── Étape 1 : Analyse un site leader et stocke son footprint ───────────────
async function analyzeLeader(url, niche, env) {
  const { headers, cf } = buildFetchOptions(env.PROXY_LIST);
  const resp = await fetch(url, { headers, cf, signal: AbortSignal.timeout(12000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  const fp = extractFullFootprint(html, url);
  const matchScore = matchFootprint(fp, niche);
  const dorks = generateDorks(fp, niche, url);

  const leader = { url, niche, fingerprint: fp, matchScore, dorks, ts: new Date().toISOString() };

  // Stocke dans les leaders de niche
  const key = `leaders:${niche}`;
  const existing = JSON.parse(await env.KV.get(key) || '[]');
  const filtered = existing.filter(l => l.url !== url);
  filtered.push(leader);
  await env.KV.put(key, JSON.stringify(filtered.slice(0, 20)));

  await logInfo(env, 'domain-hunter', 'leader-analyzed', { url, niche, matchScore, dorksCount: dorks.length });
  return leader;
}

// ─── Étape 2 : Chasse domaines via Common Crawl + check disponibilité ───────
async function huntDomains(niche, env) {
  const leaders = JSON.parse(await env.KV.get(`leaders:${niche}`) || '[]');
  if (!leaders.length) return { niche, message: 'No leaders analyzed yet', opportunities: [] };

  // Agrège les dorks de tous les leaders
  const allDorks = [...new Set(leaders.flatMap(l => l.dorks || []))];
  const leaderFps = leaders.map(l => l.fingerprint);

  // Cherche domaines dans Common Crawl qui matchent les patterns
  const candidates = await findCandidatesFromCrawl(niche, env);

  const opportunities = [];
  for (const candidate of candidates) {
    // Dédup léger 24h (sans écriture automatique comme isDuplicate)
    const seenKey = `hseen2:${candidate}`;
    if (await env.KV.get(seenKey)) continue;
    await env.KV.put(seenKey, '1', { expirationTtl: 3600 });

    if (isPolluted(`https://${candidate}`)) continue;

    const result = await assessDomain(candidate, leaderFps, niche, env);
    if (result) opportunities.push(result);

    // Limite à 20 par cycle pour rester dans le budget CPU Workers
    if (opportunities.length >= 20) break;
  }

  opportunities.sort((a, b) => b.totalScore - a.totalScore);

  const report = {
    niche,
    dorks: allDorks.slice(0, 10),
    total: opportunities.length,
    opportunities,
    ts: new Date().toISOString(),
  };

  await env.KV.put(`hunt:${niche}`, JSON.stringify(report));

  // Merge dans le rapport global /domaines
  await mergeGlobalReport(env, niche, opportunities);

  await logInfo(env, 'domain-hunter', 'hunt-complete', { niche, found: opportunities.length });
  return report;
}

// ─── Candidats depuis KV existant + Common Crawl (avec fallback) ─────────────
async function findCandidatesFromCrawl(niche, env) {
  const candidates = new Set();
  const SKIP = new Set(['github.com','google.com','youtube.com','facebook.com','twitter.com','linkedin.com','amazon.com','wikipedia.org']);

  // Source 1 — domaines déjà dans les backlinks KV
  const blKeys = await env.KV.list({ prefix: 'backlinks:' });
  for (const k of blKeys.keys) {
    const data = await env.KV.get(k.name).then(v => v ? JSON.parse(v) : null);
    if (!data?.opportunities) continue;
    for (const opp of data.opportunities.slice(0, 10)) {
      try {
        const host = new URL(opp.url).hostname.replace(/^www\./, '');
        if (!SKIP.has(host)) candidates.add(host);
      } catch { /* skip */ }
    }
  }

  // Source 2 — liens découverts par le Radar
  const radarKeys = await env.KV.list({ prefix: 'radar:' });
  for (const k of radarKeys.keys) {
    const data = await env.KV.get(k.name).then(v => v ? JSON.parse(v) : null);
    if (!data?.links) continue;
    for (const link of data.links.slice(0, 20)) {
      try {
        const host = new URL(link).hostname.replace(/^www\./, '');
        if (!SKIP.has(host) && host !== new URL(data.target).hostname) candidates.add(host);
      } catch { /* skip */ }
    }
  }

  // Source 3 — Common Crawl sur un pattern niche (rapide, 1 seule requête)
  try {
    const nicheFp = NICHE_FOOTPRINTS[niche];
    const pattern = (nicheFp?.urlPatterns || ['/blog/'])[0].replace(/\//g, '');
    const { headers } = buildFetchOptions(env.PROXY_LIST);
    const resp = await fetch(
      `https://index.commoncrawl.org/CC-MAIN-2024-10-index?url=*/${pattern}/*&output=json&limit=30`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    const text = await resp.text();
    for (const line of text.split('\n').filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        const host = new URL(entry.url).hostname.replace(/^www\./, '');
        if (!SKIP.has(host)) candidates.add(host);
      } catch { /* skip */ }
    }
  } catch { /* fallback OK */ }

  return [...candidates].slice(0, 40);
}

// ─── Évaluation complète d'un domaine candidat ──────────────────────────────
async function assessDomain(domain, leaderFps, niche, env) {
  const headers = buildStealthHeaders();

  // 1. Check DNS via Cloudflare DoH
  const dnsResult = await checkDns(domain);

  // 2. Check HTTP / parking
  let httpStatus = null;
  let parked = false;
  let domainFp = null;

  if (dnsResult.resolves) {
    try {
      const resp = await fetch(`https://${domain}`, {
        headers,
        signal: AbortSignal.timeout(8000),
        redirect: 'follow',
      });
      httpStatus = resp.status;
      const html = await resp.text();
      parked = isParked(html, '');
      if (!parked && resp.ok) {
        domainFp = extractFullFootprint(html, `https://${domain}`);
      }
    } catch { httpStatus = 0; }
  }

  // 3. Score footprint vs leaders
  let fpScore = 0;
  if (domainFp) {
    fpScore = matchFootprint(domainFp, niche);
  }

  // 4. Wayback Machine
  const wayback = await checkWayback(domain, headers);

  // 5. Diode
  const availability = classifyAvailability(dnsResult, httpStatus, parked);
  const totalScore = computeHuntScore(fpScore, wayback, availability);
  const diode = computeDiode(fpScore, availability, wayback, totalScore);

  // Blacklist auto si pollué
  if (isPolluted(`https://${domain}`)) {
    await addToBlacklist(env, domain, 'auto-detected during hunt');
    return null;
  }

  return {
    domain,
    niche,
    availability,
    httpStatus,
    parked,
    fpScore,
    wayback,
    totalScore,
    diode,
    ts: new Date().toISOString(),
  };
}

async function checkDns(domain) {
  try {
    const resp = await fetch(
      `https://cloudflare-dns.com/dns-query?name=${domain}&type=A`,
      { headers: { Accept: 'application/dns-json' }, signal: AbortSignal.timeout(5000) }
    );
    const data = await resp.json();
    const resolves = data.Status === 0 && data.Answer?.length > 0;
    const ips = resolves ? data.Answer.filter(a => a.type === 1).map(a => a.data) : [];
    return { resolves, ips, nxdomain: data.Status === 3 };
  } catch {
    return { resolves: false, ips: [], nxdomain: false };
  }
}

async function checkWayback(domain, headers) {
  try {
    const resp = await fetch(
      `https://web.archive.org/cdx/search/cdx?url=${domain}&output=json&limit=10&fl=timestamp,statuscode&filter=statuscode:200`,
      { headers, signal: AbortSignal.timeout(8000) }
    );
    if (!resp.ok) return { snapshots: 0, validated: false };
    const data = await resp.json();
    const rows = data.slice(1);
    return {
      snapshots: rows.length,
      validated: rows.length >= 2,
      oldest: rows[rows.length - 1]?.[0] || null,
      newest: rows[0]?.[0] || null,
    };
  } catch {
    return { snapshots: 0, validated: false };
  }
}

function classifyAvailability(dns, httpStatus, parked) {
  if (dns.nxdomain) return 'disponible';
  if (!dns.resolves) return 'potentiellement_disponible';
  if (parked) return 'parké';
  if (httpStatus === 404 || httpStatus === 410) return 'expiré';
  if (httpStatus === 0 || httpStatus >= 500) return 'abandonné';
  if (httpStatus === 200) return 'actif';
  return 'inconnu';
}

function computeHuntScore(fpScore, wayback, availability) {
  let score = fpScore * 0.5; // 50% du score = similarité footprint
  if (wayback.validated) score += 20;
  if (wayback.snapshots >= 5) score += 10;
  if (availability === 'disponible') score += 20;
  else if (availability === 'parké') score += 15;
  else if (availability === 'expiré') score += 15;
  else if (availability === 'abandonné') score += 10;
  return Math.round(score);
}

function computeDiode(fpScore, availability, wayback, totalScore) {
  const acquirable = ['disponible', 'parké', 'expiré', 'potentiellement_disponible', 'abandonné'];
  const isAcquirable = acquirable.includes(availability);

  // Domaine parké/expiré/libre avec historique validé = opportunité d'achat directe
  if (isAcquirable && wayback.validated && wayback.snapshots >= 3) {
    if (fpScore >= 40) {
      return { color: 'orange', verdict: 'ALERTE ACHAT', priority: 1, reason: `${availability} + Wayback ${wayback.snapshots} snaps + fp ${fpScore}%` };
    }
    return { color: 'yellow', verdict: 'À ANALYSER', priority: 2, reason: `${availability} + Wayback ${wayback.snapshots} snaps` };
  }
  // Footprint fort + non-actif = à analyser
  if (fpScore >= 50 && isAcquirable) {
    return { color: 'yellow', verdict: 'À ANALYSER', priority: 2, reason: `Footprint ${fpScore}% + ${availability}` };
  }
  if (availability === 'disponible' && wayback.validated) {
    return { color: 'blue', verdict: 'DISPONIBLE', priority: 3, reason: 'Disponible avec historique' };
  }
  if (availability === 'actif') {
    return { color: 'green', verdict: 'ACTIF', priority: 5, reason: 'Site en ligne' };
  }
  return { color: 'grey', verdict: 'SURVEILLER', priority: 4, reason: `Score ${totalScore}/100` };
}

function generateDorks(fp, niche, leaderUrl) {
  const domain = new URL(leaderUrl).hostname;
  const dorks = [];

  // Dorks basés sur les classes CSS uniques
  const uniqueClasses = fp.classes.slice(0, 3);
  for (const cls of uniqueClasses) {
    dorks.push(`intext:"class=\"${cls}\"" -site:${domain}`);
  }

  // Dorks basés sur les scripts tiers
  for (const script of fp.thirdParty.slice(0, 2)) {
    dorks.push(`"${script}" "write for us" site:*.com -site:${domain}`);
  }

  // Dorks basés sur les schémas
  for (const schema of fp.schemaTypes.slice(0, 2)) {
    dorks.push(`"@type":"${schema}" "guest post" -site:${domain}`);
  }

  return dorks.slice(0, 8);
}

async function mergeGlobalReport(env, niche, opportunities) {
  const key = 'domains:report';
  const existing = JSON.parse(await env.KV.get(key) || '{"opportunities":[]}');
  const merged = [
    ...existing.opportunities.filter(o => o.niche !== niche),
    ...opportunities,
  ].sort((a, b) => (a.diode?.priority || 9) - (b.diode?.priority || 9));

  await env.KV.put(key, JSON.stringify({
    ts: new Date().toISOString(),
    total: merged.length,
    opportunities: merged.slice(0, 200),
  }));
}

async function getReport(env) {
  const raw = await env.KV.get('domains:report');
  return raw ? JSON.parse(raw) : { total: 0, opportunities: [] };
}
