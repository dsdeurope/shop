/**
 * Lib: Stealth
 * Rotation de proxys et masquage d'empreinte HTTP.
 */

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
];

const ACCEPT_LANGUAGES = [
  'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  'en-US,en;q=0.9',
  'de-DE,de;q=0.9,en-US;q=0.8',
  'es-ES,es;q=0.9,en;q=0.8',
];

const ACCEPT_HEADERS = [
  'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
];

export function buildStealthHeaders() {
  return {
    'User-Agent': pick(USER_AGENTS),
    'Accept': pick(ACCEPT_HEADERS),
    'Accept-Language': pick(ACCEPT_LANGUAGES),
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
  };
}

/**
 * Retourne un proxy depuis la liste env PROXY_LIST (JSON array of strings).
 * Format: "http://user:pass@host:port" ou "socks5://host:port"
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

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
