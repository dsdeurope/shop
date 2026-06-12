import { mainCss } from './templates/css.js';
import { htaccess, robotsTxt, mainJs } from './templates/assets.js';
import {
  configPhp, headerPhp, footerPhp,
  indexPhp, collectionsIndexPhp, collectionPhp,
  blogIndexPhp, articlePhp, sitemapPhp,
  mentionsLegalesPhp, configJson,
} from './templates/php.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json',
};

const PALETTE_WORKER = 'https://v35-color-palette.ernestpedanou.workers.dev';

function brand(domain) {
  return domain.replace(/^www\./, '').split('.')[0]
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

async function fetchPalette(niche, env) {
  // Try color-palette worker, fallback to generic
  try {
    const r = await fetch(`${PALETTE_WORKER}/?niche=${encodeURIComponent(niche)}`);
    if (r.ok) return await r.json();
  } catch {}
  // Neutral fallback
  return {
    primary: '#4f46e5', primary_dark: '#3730a3', primary_light: '#ede9fe',
    secondary: '#7c3aed', accent: '#f59e0b', surface: '#f8fafc', bg: '#ffffff',
    text: '#1e1b4b', text_muted: '#6b7280', border: '#e2e8f0',
    gradient_from: '#4f46e5', gradient_to: '#312e81', hero_text: '#ffffff',
  };
}

function buildFiles(bp, domain, brandName, niche, p) {
  const files = {};

  // CSS
  files['assets/css/main.css'] = mainCss(p);

  // JS
  files['assets/js/main.js'] = mainJs;

  // .htaccess
  files['.htaccess'] = htaccess;

  // robots.txt
  files['robots.txt'] = robotsTxt(domain);

  // PHP includes
  files['includes/config.php'] = configPhp(domain, brandName, niche, p);
  files['includes/header.php'] = headerPhp(brandName, p);
  files['includes/footer.php'] = footerPhp(brandName, domain);

  // Pages
  files['index.php'] = indexPhp(domain, brandName, niche);
  files['collections/index.php'] = collectionsIndexPhp();
  files['collections/collection.php'] = collectionPhp();
  files['blog/index.php'] = blogIndexPhp();
  files['blog/article.php'] = articlePhp();
  files['sitemap.php'] = sitemapPhp(domain);
  files['mentions-legales.php'] = mentionsLegalesPhp(domain, brandName);

  // Data
  const collections = (bp.collections || []).map(c => ({
    handle: c.handle,
    title: c.title,
    description: c.description || '',
    count: c.productsCount || c.count || 0,
    emoji: c.emoji || '🛍',
    image: c.image || '',
    tag: c.tag || '',
  }));

  // Inject collections into config
  const cfg = JSON.parse(configJson(domain, brandName, niche));
  cfg.collections = collections;
  files['data/config.json'] = JSON.stringify(cfg, null, 2);
  files['data/collections.json'] = JSON.stringify(collections, null, 2);

  // Empty posts array
  files['data/posts.json'] = JSON.stringify([], null, 2);

  // Per-collection product placeholder files
  for (const col of collections) {
    files[`data/products/${col.handle}.json`] = JSON.stringify([], null, 2);
  }

  // Empty dirs placeholders (.gitkeep style)
  files['cache/.htaccess'] = 'Deny from all\n';

  return files;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return new Response('POST required', { status: 405, headers: CORS });

    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS }); }

    const { blueprint: bp, domain, niche = 'generique' } = body;
    if (!bp || !domain) return Response.json({ error: 'blueprint + domain required' }, { status: 400, headers: CORS });

    const brandName = brand(domain);
    const palette = await fetchPalette(niche, env);
    const files = buildFiles(bp, domain, brandName, niche, palette);

    const summary = {
      domain,
      brand: brandName,
      niche,
      palette: { primary: palette.primary, accent: palette.accent },
      file_count: Object.keys(files).length,
      files,
    };

    return Response.json(summary, { headers: CORS });
  }
};
