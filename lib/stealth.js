/**
 * Lib: Stealth
 * Rotation UA/headers + exploitation native des PoPs Cloudflare (300+ IPs).
 * Si PROXY_LIST est fourni, rotation externe ; sinon fallback sur edge CF.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
];

const ACCEPT_LANGUAGES = [
  'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'en-US,en;q=0.9',
  'de-DE,de;q=0.9,en-US;q=0.8',
  'es-ES,es;q=0.9,en;q=0.8',
  'it-IT,it;q=0.9,en-US;q=0.8',
  'pt-BR,pt;q=0.9,en-US;q=0.8',
];

const ACCEPT_HEADERS = [
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
];

// Délai aléatoire entre requêtes pour simuler un comportement humain
export function randomDelay(minMs = 800, maxMs = 3500) {
  return new Promise(r => setTimeout(r, minMs + Math.random() * (maxMs - minMs)));
}

export function buildStealthHeaders() {
  const ua = pick(USER_AGENTS);
  const isMobile = ua.includes('iPhone') || ua.includes('iPad');
  const isChrome = ua.includes('Chrome') && !ua.includes('Edg');

  const headers = {
    'User-Agent': ua,
    'Accept': pick(ACCEPT_HEADERS),
    'Accept-Language': pick(ACCEPT_LANGUAGES),
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': pick(['none', 'same-origin', 'cross-site']),
    'Sec-Fetch-User': '?1',
    'Cache-Control': pick(['max-age=0', 'no-cache']),
  };

  // Headers Chrome spécifiques
  if (isChrome) {
    headers['Sec-CH-UA'] = `"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"`;
    headers['Sec-CH-UA-Mobile'] = isMobile ? '?1' : '?0';
    headers['Sec-CH-UA-Platform'] = isMobile ? '"iOS"' : pick(['"Windows"', '"macOS"', '"Linux"']);
  }

  return headers;
}

/**
 * Retourne un proxy depuis PROXY_LIST (JSON array).
 * Si liste vide → undefined (Workers utilisent les IPs edge CF nativement).
 */
export function rotateProxy(proxyListJson) {
  if (!proxyListJson) return undefined;
  try {
    const list = JSON.parse(proxyListJson);
    if (!list.length) return undefined;
    return list[Math.floor(Math.random() * list.length)];
  } catch {
    return undefined;
  }
}

/**
 * Options fetch enrichies — exploite les PoPs CF si pas de proxy externe.
 * cf.cacheEverything=false force un passage par l'edge sans cache.
 */
export function buildFetchOptions(proxyListJson) {
  const headers = buildStealthHeaders();
  const proxy = rotateProxy(proxyListJson);

  const cfOptions = {
    cacheEverything: false,
    cacheTtl: 0,
  };
  if (proxy) cfOptions.resolveOverride = proxy;

  return { headers, cf: cfOptions };
}

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
