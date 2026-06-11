/**
 * Lib: SEO
 * Filtrage, scoring, extraction d'entités et maillage en silos.
 */

const BLACKLIST_PATTERNS = [
  /casino/i, /poker/i, /slot/i, /gambling/i,
  /pharma/i, /viagra/i, /cialis/i, /levitra/i,
  /porn/i, /adult/i, /xxx/i, /sex/i, /escort/i,
  /crypto-pump/i, /forex-signal/i,
];

const SILO_KEYWORDS = {
  ecommerce: ['shop', 'boutique', 'acheter', 'prix', 'produit', 'panier', 'livraison'],
  tech: ['logiciel', 'api', 'developpement', 'cloud', 'ia', 'automatisation'],
  marketing: ['seo', 'référencement', 'backlink', 'trafic', 'conversion', 'leads'],
  local: ['paris', 'france', 'lyon', 'marseille', 'bordeaux', 'toulouse'],
};

export function filterPolluted(urls, extraKeywords = []) {
  const patterns = [...BLACKLIST_PATTERNS, ...extraKeywords.map(k => new RegExp(k, 'i'))];
  return urls.filter(url => !patterns.some(p => p.test(url)));
}

export function extractEntities(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const entities = {
    brands: extractPattern(text, /\b[A-Z][a-z]+ (?:[A-Z][a-z]+ )?(?:SAS|SARL|SA|Ltd|Inc|Corp|GmbH)\b/g),
    locations: extractPattern(text, /\b(?:Paris|Lyon|Marseille|Bordeaux|Toulouse|Nantes|Strasbourg|Nice)\b/g),
    longTail: extractLongTail(text),
    silo: detectSilo(text),
  };
  return entities;
}

export async function scoreDomain(url, env) {
  // Score basé sur les données KV mises en cache
  const cached = await env.KV.get(`score:${url}`);
  if (cached) return JSON.parse(cached);

  let score = 50; // Base
  try {
    const domain = new URL(url).hostname;
    if (domain.includes('.edu') || domain.includes('.gov')) score += 30;
    if (domain.includes('.org')) score += 10;
    if (filterPolluted([url]).length === 0) return 0; // Polluted
  } catch {
    return 0;
  }

  await env.KV.put(`score:${url}`, JSON.stringify(score), { expirationTtl: 86400 });
  return score;
}

export function buildSiloStructure(links) {
  const silos = Object.fromEntries(Object.keys(SILO_KEYWORDS).map(k => [k, []]));
  silos.other = [];

  for (const link of links) {
    const lower = link.toLowerCase();
    let assigned = false;
    for (const [silo, keywords] of Object.entries(SILO_KEYWORDS)) {
      if (keywords.some(kw => lower.includes(kw))) {
        silos[silo].push(link);
        assigned = true;
        break;
      }
    }
    if (!assigned) silos.other.push(link);
  }
  return silos;
}

function extractPattern(text, regex) {
  return [...new Set([...text.matchAll(regex)].map(m => m[0]))].slice(0, 20);
}

function extractLongTail(text) {
  const words = text.toLowerCase().match(/\b[a-zàâçéèêëîïôûùüÿæœ]{4,}\b/g) || [];
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([w]) => w);
}

function detectSilo(text) {
  const lower = text.toLowerCase();
  const scores = {};
  for (const [silo, keywords] of Object.entries(SILO_KEYWORDS)) {
    scores[silo] = keywords.filter(k => lower.includes(k)).length;
  }
  return Object.entries(scores).sort((a, b) => b[1] - a[1])[0]?.[0] || 'other';
}
