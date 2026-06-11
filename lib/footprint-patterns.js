/**
 * Lib: FootprintPatterns
 * Extraction et matching d'empreintes digitales SEO.
 * Plateformes couvertes : Shopify, WooCommerce, PrestaShop, Magento, BigCommerce, Wix
 */

const PARKING_PATTERNS = [
  /domain.?for.?sale/i, /parked.?domain/i, /buy.?this.?domain/i,
  /this.?domain.?is.?for.?sale/i, /under.?construction/i,
  /coming.?soon/i, /domain.?parking/i, /sedo\.com/i,
  /godaddy\.com\/domain/i, /namecheap\.com\/domains/i,
  /hugedomains\.com/i, /dan\.com/i, /afternic/i,
  /registrar-servers\.com/i, /parkingcrew/i,
];

const PARKING_IPS = new Set([
  '184.168.221.', '184.168.131.', '50.63.202.',
  '205.251.196.', '205.251.197.',
  '162.0.209.', '162.0.210.',
  '195.201.', '46.105.',
]);

// Plateformes e-commerce — signaux de détection forte
const ECOMMERCE_PLATFORMS = {
  shopify: {
    meta: /content="Shopify"/i,
    cdn: /cdn\.shopify\.com\/s\/files\//i,
    js: /Shopify\.theme|shopify\.com\/s\/files/i,
    classes: ['shopify-section', 'site-header__logo'],
    cookie: /_shopify_y|_shopify_s/,
    urlHints: ['/products/', '/collections/', '/cart/'],
  },
  woocommerce: {
    meta: /content="WooCommerce"/i,
    cdn: /wp-content\/plugins\/woocommerce\//i,
    js: /wc-add-to-cart\.min\.js|woocommerce\.min\.js/i,
    classes: ['woocommerce', 'woocommerce-page', 'product_item'],
    cookie: /woocommerce_/,
    urlHints: ['/product/', '/product-category/', '/cart/', '/checkout/'],
  },
  prestashop: {
    meta: /content="PrestaShop"/i,
    cdn: /\/themes\/|\/js\/jquery\//i,
    js: /prestashop|presta-/i,
    classes: ['blockcart', 'product_list', 'ajax_cart'],
    comment: /Module PrestaShop/i,
    urlHints: ['/module/', '/index.php?id_product=', '/content/'],
  },
  magento: {
    meta: /Magento|Adobe Commerce/i,
    cdn: /\/static\/version|\/media\/catalog\//i,
    js: /requirejs|mage\//i,
    classes: ['block-search', 'minicart-wrapper', 'page-wrapper'],
    urlHints: ['/catalog/product/view/', '/checkout/cart/'],
  },
  bigcommerce: {
    meta: /BigCommerce/i,
    cdn: /cdn11\.bigcommerce\.com/i,
    js: /bigcommerce/i,
    classes: ['navUser-item--cart', 'productView', 'sidebarBlock'],
    urlHints: ['/product.php', '/cart.php'],
  },
  wix: {
    meta: /Wix\.com/i,
    cdn: /static\.wixstatic\.com/i,
    js: /wix-apps|wix-bi-core/i,
    classes: ['wixui-', 'SITE_HEADER'],
    urlHints: ['/product-page/'],
  },
};

export const NICHE_FOOTPRINTS = {
  seo_blog: {
    classes: ['post-content', 'entry-content', 'article-body', 'post-meta', 'author-bio'],
    metas: ['og:type=article', 'article:author', 'article:section'],
    scripts: ['rank-math', 'yoast', 'schema-org', 'fathom', 'clarity'],
    urlPatterns: ['/blog/', '/seo/', '/guide/', '/tutorial/', '/category/seo/'],
    schemaTypes: ['Article', 'BlogPosting', 'Person', 'BreadcrumbList'],
    platformBonus: ['rank-math', 'yoast'],
  },
  ecommerce: {
    classes: [
      // Shopify
      'shopify-section', 'site-header__logo',
      // WooCommerce
      'woocommerce', 'woocommerce-page', 'product_item', 'single_add_to_cart_button',
      // PrestaShop
      'blockcart', 'product_list', 'ajax_cart',
      // Magento
      'block-search', 'minicart-wrapper',
      // BigCommerce
      'navUser-item--cart', 'productView',
    ],
    metas: ['og:type=product', 'product:price:amount', 'product:availability'],
    scripts: [
      'cdn.shopify.com', 'shopify',
      'woocommerce', 'wp-content/plugins/woocommerce', 'wc-add-to-cart',
      'prestashop',
      'cdn11.bigcommerce.com', 'bigcommerce',
      'requirejs', 'mage/',
      'static.wixstatic.com', 'wix-apps',
      'stripe', 'paypal', 'klarna', 'snipcart', 'ecwid',
    ],
    urlPatterns: [
      '/products/', '/collections/', '/cart/',
      '/product/', '/product-category/', '/checkout/', '/catalog/product/',
      '/boutique/', '/commande/', '/panier/', '/shop/', '/produit/',
    ],
    schemaTypes: ['Product', 'Offer', 'AggregateRating', 'ItemList'],
    platformBonus: ['shopify', 'woocommerce', 'prestashop', 'magento', 'bigcommerce', 'wix', 'snipcart', 'ecwid'],
  },
  local_seo: {
    classes: ['local-business', 'address', 'phone', 'opening-hours', 'map-embed'],
    metas: ['geo.position', 'geo.placename', 'og:locality'],
    scripts: ['google-maps', 'gmb', 'locallogic'],
    urlPatterns: ['/contact/', '/about/', '/location/', '/nos-agences/'],
    schemaTypes: ['LocalBusiness', 'PostalAddress', 'GeoCoordinates', 'OpeningHoursSpecification'],
    platformBonus: ['google-maps', 'gmb'],
  },
  marketing_agency: {
    classes: ['case-study', 'testimonial', 'services', 'portfolio', 'client-logo'],
    metas: ['og:type=website', 'description'],
    scripts: ['hubspot', 'marketo', 'pardot', 'intercom', 'hotjar'],
    urlPatterns: ['/services/', '/case-studies/', '/portfolio/', '/clients/'],
    schemaTypes: ['Organization', 'Service', 'Review', 'FAQPage'],
    platformBonus: ['hubspot', 'marketo', 'pardot'],
  },
};

export function matchFootprint(extractedFp, nicheName) {
  const niche = NICHE_FOOTPRINTS[nicheName];
  if (!niche) return 0;

  let score = 0;
  let maxScore = 0;

  // Classes CSS (poids 30)
  maxScore += 30;
  const classMatches = niche.classes.filter(c =>
    extractedFp.classes?.some(ec => ec.includes(c))
  ).length;
  score += (classMatches / niche.classes.length) * 30;

  // Schema types (poids 25)
  maxScore += 25;
  const schemaMatches = niche.schemaTypes.filter(s =>
    extractedFp.schemaTypes?.includes(s)
  ).length;
  score += (schemaMatches / niche.schemaTypes.length) * 25;

  // Scripts (poids 25) — src URLs + thirdParty (détection inline)
  maxScore += 25;
  const allScripts = [...(extractedFp.scripts || []), ...(extractedFp.thirdParty || [])];
  const scriptMatches = niche.scripts.filter(s =>
    allScripts.some(es => es.includes(s))
  ).length;
  score += (scriptMatches / niche.scripts.length) * 25;

  // URL patterns (poids 20)
  maxScore += 20;
  const urlMatches = niche.urlPatterns.filter(p =>
    extractedFp.urlPatterns?.some(ep => ep.includes(p.replace(/\//g, '')))
  ).length;
  score += (urlMatches / niche.urlPatterns.length) * 20;

  const base = Math.round((score / maxScore) * 100);

  // Bonus plateforme (+20) — signal fort indépendant du CSS
  const platformBonus = (niche.platformBonus || []).some(p =>
    (extractedFp.thirdParty || []).includes(p)
  ) ? 20 : 0;

  return Math.min(100, base + platformBonus);
}

/** Détecte la plateforme e-commerce précise depuis le HTML */
export function detectPlatform(html) {
  for (const [name, sig] of Object.entries(ECOMMERCE_PLATFORMS)) {
    if (sig.meta?.test(html)) return name;
    if (sig.cdn?.test(html)) return name;
    if (sig.js?.test(html)) return name;
    if (sig.comment?.test(html)) return name;
  }
  return null;
}

export function isParked(html, title = '') {
  if (PARKING_PATTERNS.some(p => p.test(html) || p.test(title))) return true;
  return html.replace(/<[^>]+>/g, '').trim().length < 200;
}

export function isParkingIp(ip) {
  return PARKING_IPS.has(ip?.slice(0, ip.lastIndexOf('.') + 1));
}

export function extractFullFootprint(html, url) {
  const fp = {
    classes: [],
    ids: [],
    scripts: [],
    schemaTypes: [],
    metaTags: {},
    urlPatterns: [],
    thirdParty: [],
    platform: null,
  };

  // Classes CSS (top 50 fréquentes, filtre CSS-in-JS)
  const classFreq = {};
  for (const m of html.matchAll(/class="([^"]+)"/g)) {
    for (const c of m[1].split(' ')) {
      if (c.length > 3) classFreq[c] = (classFreq[c] || 0) + 1;
    }
  }
  fp.classes = Object.entries(classFreq)
    .filter(([c]) => !(/^(css-|sc-|_|[a-z]+-[0-9a-f]{5,}$|chakra-|emotion-)/.test(c)) && c.length > 4)
    .sort((a, b) => b[1] - a[1]).slice(0, 50).map(([c]) => c);

  // IDs
  fp.ids = [...new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]))].slice(0, 20);

  // Scripts src
  fp.scripts = [...new Set(
    [...html.matchAll(/src="(https?:\/\/[^"]+\.js[^"]*)"/gi)].map(m => m[1])
  )].slice(0, 30);

  // ── Détection plateforme e-commerce ─────────────────────────────────────
  fp.platform = detectPlatform(html);
  if (fp.platform) fp.thirdParty.push(fp.platform);

  // Détection via balise meta generator
  const genMatch = html.match(/<meta[^>]+name="generator"[^>]+content="([^"]+)"/i)
    || html.match(/<meta[^>]+content="([^"]+)"[^>]+name="generator"/i);
  if (genMatch) fp.metaTags['generator'] = genMatch[1];

  // ── SEO & Marketing tiers ────────────────────────────────────────────────
  if (/gtag|google-analytics/i.test(html)) fp.thirdParty.push('google-analytics');
  if (/fbq|facebook\.net/i.test(html)) fp.thirdParty.push('facebook-pixel');
  if (/_hsq|hubspot/i.test(html)) fp.thirdParty.push('hubspot');
  if (/marketo/i.test(html)) fp.thirdParty.push('marketo');
  if (/pardot/i.test(html)) fp.thirdParty.push('pardot');
  if (/intercom/i.test(html)) fp.thirdParty.push('intercom');
  if (/hotjar/i.test(html)) fp.thirdParty.push('hotjar');
  if (/clarity\.ms/i.test(html)) fp.thirdParty.push('clarity');
  if (/rank.?math/i.test(html)) fp.thirdParty.push('rank-math');
  if (/yoast/i.test(html)) fp.thirdParty.push('yoast');

  // ── Paiement ────────────────────────────────────────────────────────────
  if (/stripe\.js|js\.stripe\.com/i.test(html)) fp.thirdParty.push('stripe');
  if (/paypal/i.test(html)) fp.thirdParty.push('paypal');
  if (/klarna/i.test(html)) fp.thirdParty.push('klarna');
  if (/snipcart/i.test(html)) fp.thirdParty.push('snipcart');
  if (/ecwid/i.test(html)) fp.thirdParty.push('ecwid');
  if (/ReChargeWidget|recharge\.com/i.test(html)) fp.thirdParty.push('recharge');

  // Schema.org
  fp.schemaTypes = [...new Set([...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1]))];

  // Meta tags
  for (const m of html.matchAll(/<meta[^>]+(?:name|property)="([^"]+)"[^>]+content="([^"]+)"/gi)) {
    fp.metaTags[m[1]] = m[2].slice(0, 100);
  }

  // URL patterns — liens internes + path de la page analysée elle-même
  try {
    const links = [...html.matchAll(/href="(\/[^"]+)"/g)].map(m => m[1]);
    const segs = new Set(links.map(l => '/' + l.split('/').filter(Boolean)[0]).filter(Boolean));
    // Inclut les segments du URL courant (ex: /products/ si on analyse une page produit)
    const selfParts = url.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean);
    for (const s of selfParts) segs.add('/' + s);
    fp.urlPatterns = [...segs].slice(0, 20);
  } catch { /* skip */ }

  return fp;
}
