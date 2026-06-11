/**
 * Lib: Logger
 * Logging centralisé vers KV avec support alertes auto-pause.
 */

export async function logError(env, worker, message, context = {}) {
  try {
    const key = `log:error:${worker}:${Date.now()}`;
    await env.LOGS.put(key, JSON.stringify({ level: 'error', worker, message, context, ts: new Date().toISOString() }), { expirationTtl: 604800 });
  } catch { /* silently ignore when KV quota exceeded */ }
}

export async function logInfo(env, worker, message, context = {}) {
  try {
    const key = `log:info:${worker}:${Date.now()}`;
    await env.LOGS.put(key, JSON.stringify({ level: 'info', worker, message, context, ts: new Date().toISOString() }), { expirationTtl: 86400 });
  } catch { /* silently ignore when KV quota exceeded */ }
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
