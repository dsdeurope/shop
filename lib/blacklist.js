/**
 * Lib: Blacklist dynamique — Casino/Pharma/Adulte + domaines bannis
 * Chargée depuis KV (mise à jour par la Sentinelle) + patterns statiques.
 */

const STATIC_PATTERNS = [
  // Casino / Gambling
  /casino|poker|slot|gambling|bet(?:ting)?|jackpot|roulette|blackjack/i,
  // Pharma
  /pharma|viagra|cialis|levitra|tramadol|xanax|valium|oxycodon/i,
  // Adulte
  /porn|adult|xxx|sex(?:cam|tube|chat)?|escort|onlyfans|cam(?:girl|boy)/i,
  // Spam SEO
  /crypto.?pump|forex.?signal|payday.?loan|replica.?watch|free.?follower/i,
  // Malware
  /malware|phishing|scam|hack(?:ed)?|cracked?/i,
];

export async function loadBlacklist(env) {
  const dynamic = await env.KV.get('blacklist:dynamic').then(v => v ? JSON.parse(v) : []);
  return dynamic;
}

export async function addToBlacklist(env, domain, reason) {
  const list = await loadBlacklist(env);
  if (!list.find(e => e.domain === domain)) {
    list.push({ domain, reason, ts: new Date().toISOString() });
    await env.KV.put('blacklist:dynamic', JSON.stringify(list));
  }
}

export function isPolluted(url, dynamicList = []) {
  if (STATIC_PATTERNS.some(p => p.test(url))) return true;
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return dynamicList.some(e => hostname === e.domain || hostname.endsWith(`.${e.domain}`));
  } catch { return true; }
}

export function filterClean(urls, dynamicList = []) {
  return urls.filter(u => !isPolluted(u, dynamicList));
}
