/**
 * Worker: Dashboard API
 * Agrège les données KV pour le dashboard shop.zenitlab.net.
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS
    const origin = request.headers.get('origin') || '';
    const allowed = ['https://shop.zenithlab.net', 'https://v35-dashboard-api.ernestpedanou.workers.dev'];
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
      'Content-Type': 'application/json',
    };

    if (url.pathname !== '/api/dashboard') {
      return new Response('Not found', { status: 404 });
    }

    try {
      const data = await aggregateDashboard(env);
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  },
};

async function aggregateDashboard(env) {
  const [
    radarKeys, backlinkKeys, healthKeys,
    sentReport, optReport, seqReport, securityLog,
  ] = await Promise.all([
    env.KV.list({ prefix: 'radar:' }),
    env.KV.list({ prefix: 'backlinks:' }),
    env.KV.list({ prefix: 'health:' }),
    env.KV.get('sentinelle:last-report').then(v => v ? JSON.parse(v) : null),
    env.KV.get('optimiseur:last-report').then(v => v ? JSON.parse(v) : null),
    env.KV.get('sequenceur:last-report').then(v => v ? JSON.parse(v) : null),
    env.KV.get('security-log').then(v => v || ''),
  ]);

  // Scores santé moyens
  let totalScore = 0, healthCount = 0;
  for (const k of healthKeys.keys.slice(0, 20)) {
    const d = await env.KV.get(k.name).then(v => v ? JSON.parse(v) : null);
    if (d?.score != null) { totalScore += d.score; healthCount++; }
  }

  // Backlinks totaux
  let totalBacklinks = 0;
  for (const k of backlinkKeys.keys.slice(0, 10)) {
    const d = await env.KV.get(k.name).then(v => v ? JSON.parse(v) : null);
    totalBacklinks += d?.opportunities?.length ?? 0;
  }

  // Statuts agents
  const agentStatuses = {};
  const workers = ['radar', 'backlink-hunter', 'domain-health', 'sentinelle', 'optimiseur', 'sequenceur'];
  for (const w of workers) {
    const paused = await env.KV.get(`config:${w}:paused`);
    agentStatuses[w] = paused ? 'pause' : 'ok';
  }

  // Overrides depuis sentinelle
  if (sentReport?.threats?.length) {
    for (const t of sentReport.threats) {
      agentStatuses[t.worker] = t.type === 'ban-detected' ? 'warn' : 'err';
    }
  }

  // Logs récents
  const logKeys = await env.KV.list({ prefix: 'log:' });
  const recentLogs = [];
  for (const k of logKeys.keys.slice(-10)) {
    const v = await env.KV.get(k.name).then(v => v ? JSON.parse(v) : null);
    if (v) recentLogs.push(v);
  }

  // Taux d'erreur global
  const errorLogs = recentLogs.filter(l => l.level === 'error');
  const errorRate = recentLogs.length ? errorLogs.length / recentLogs.length : 0;

  return {
    domainsDiscovered: radarKeys.keys.length,
    backlinksFound: totalBacklinks,
    avgHealthScore: healthCount ? Math.round(totalScore / healthCount) : null,
    errorRate,
    queueSize: seqReport?.queued ?? 0,
    silos: seqReport?.siloSizes ?? {},
    agentStatuses,
    recentLogs: recentLogs.slice(-20),
    securityEvents: securityLog.split('\n').filter(Boolean).slice(-5),
    ts: new Date().toISOString(),
  };
}
