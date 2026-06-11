/**
 * Lib: Logger
 * Logging centralisé vers KV avec support alertes auto-pause.
 */

export async function logError(env, worker, message, context = {}) {
  const key = `log:error:${worker}:${Date.now()}`;
  const entry = { level: 'error', worker, message, context, ts: new Date().toISOString() };
  await env.LOGS.put(key, JSON.stringify(entry), { expirationTtl: 604800 }); // 7j
}

export async function logInfo(env, worker, message, context = {}) {
  const key = `log:info:${worker}:${Date.now()}`;
  const entry = { level: 'info', worker, message, context, ts: new Date().toISOString() };
  await env.LOGS.put(key, JSON.stringify(entry), { expirationTtl: 86400 }); // 1j
}

export async function getRecentErrors(env, worker, limit = 20) {
  const prefix = `log:error:${worker}:`;
  const list = await env.LOGS.list({ prefix, limit });
  const entries = await Promise.all(
    list.keys.map(k => env.LOGS.get(k.name).then(v => JSON.parse(v)))
  );
  return entries.sort((a, b) => b.ts.localeCompare(a.ts));
}

export async function getErrorRate(env, worker, windowMs = 3600000) {
  const errors = await getRecentErrors(env, worker, 100);
  const cutoff = new Date(Date.now() - windowMs).toISOString();
  const recent = errors.filter(e => e.ts > cutoff);
  return recent.length;
}
