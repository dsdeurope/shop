/**
 * Lib: Hash — déduplication SHA-256 via Web Crypto (natif Workers)
 */

export async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Retourne true si l'URL est déjà connue, sinon l'enregistre (TTL 30j) */
export async function isDuplicate(env, url) {
  const key = `dedup:${await sha256(url)}`;
  if (await env.KV.get(key)) return true;
  await env.KV.put(key, '1', { expirationTtl: 2592000 });
  return false;
}

/** Enregistre un spot backlink avec toutes ses métadonnées */
export async function storeSpot(env, spot) {
  const hash = await sha256(spot.url);
  const key = `spot:${hash}`;
  const existing = await env.KV.get(key);
  if (existing) return false; // doublon
  await env.KV.put(key, JSON.stringify({ ...spot, hash, ts: new Date().toISOString() }));
  // Index par domaine
  const domainKey = `spots:domain:${spot.domain}`;
  const list = JSON.parse(await env.KV.get(domainKey) || '[]');
  list.push(hash);
  await env.KV.put(domainKey, JSON.stringify(list));
  return true;
}

/** Récupère les spots d'un domaine */
export async function getSpots(env, domain, limit = 50) {
  const domainKey = `spots:domain:${domain}`;
  const hashes = JSON.parse(await env.KV.get(domainKey) || '[]');
  const spots = await Promise.all(
    hashes.slice(0, limit).map(h => env.KV.get(`spot:${h}`).then(v => v ? JSON.parse(v) : null))
  );
  return spots.filter(Boolean);
}
