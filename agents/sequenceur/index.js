/**
 * Agent: Séquenceur
 * Orchestration SEO — maillage en silos, séquençage des tâches.
 */

import { buildSiloStructure } from '../../lib/seo.js';
import { logInfo } from '../../lib/logger.js';

export default {
  async scheduled(event, env) {
    await sequence(env);
  },
  async fetch(request, env) {
    const result = await sequence(env);
    return Response.json(result);
  },
};

async function sequence(env) {
  // Récupère tous les liens découverts par le Radar
  const radarKeys = await env.KV.list({ prefix: 'radar:' });
  const allLinks = [];

  for (const key of radarKeys.keys) {
    const data = await env.KV.get(key.name).then(v => (v ? JSON.parse(v) : null));
    if (data?.links) allLinks.push(...data.links);
  }

  const silos = buildSiloStructure([...new Set(allLinks)]);

  // Séquence les domaines à analyser par priorité de silo
  const priorityOrder = ['ecommerce', 'marketing', 'tech', 'local', 'other'];
  const queue = [];
  for (const silo of priorityOrder) {
    if (silos[silo]?.length) {
      queue.push(...silos[silo].slice(0, 10).map(url => ({ url, silo })));
    }
  }

  // Alimente les queues des workers
  await env.KV.put('queue:radar', JSON.stringify(queue.map(q => q.url)));
  await env.KV.put('queue:backlink-hunter', JSON.stringify(queue.map(q => {
    try { return new URL(q.url).hostname; } catch { return null; }
  }).filter(Boolean)));

  const report = {
    ts: new Date().toISOString(),
    siloSizes: Object.fromEntries(Object.entries(silos).map(([k, v]) => [k, v.length])),
    queued: queue.length,
  };

  await logInfo(env, 'sequenceur', 'cycle-complete', report);
  await env.KV.put('sequenceur:last-report', JSON.stringify(report));
  return report;
}
