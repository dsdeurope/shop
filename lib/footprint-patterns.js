/**
 * Lib: FootprintPatterns
 * Extraction et matching d'empreintes digitales SEO.
 */

// Parking providers — IPs et patterns connus
const PARKING_PATTERNS = [
  /domain.?for.?sale/i, /parked.?domain/i, /buy.?this.?domain/i,
  /this.?domain.?is.?for.?sale/i, /under.?construction/i,
  /coming.?soon/i, /domain.?parking/i, /sedo\.com/i,
  /godaddy\.com\/domain/i, /namecheap\.com\/domains/i,
  /hugedomains\.com/i, /dan\.com/i, /afternic/i,
  /registrar-servers\.com/i, /parkingcrew/i,
];

const PARKING_IPS = new Set([
  '184.168.221.', '184.168.131.', '50.63.202.',  // GoDaddy parking
  '205.251.196.', '205.251.197.',                  // Route53 parked
  '162.0.209.', '162.0.210.',                      // NameCheap parked
  '195.201.', '46.105.',                            // OVH parking
]);

// Patterns SEO structurels par niche
export const NICHE_FOOTPRINTS = {
  seo_blog: {
    classes: ['post-content', 'entry-content', 'article-body', 'post-meta', 'author-bio'],
    metas: ['og:type=article', 'article:author', 'article:section'],
    scripts: ['rank-math', 'yoast', 'schema-org', 'fathom', 'clarity'],
    urlPatterns: ['/blog/', '/seo/', '/guide/', '/tutorial/', '/category/seo/'],
    schemaTypes: ['Article', 'BlogPosting', 'Person', 'BreadcrumbList'],
  },
  ecommerce: {
    // Shopify: product-form, shopify-payment-button, data-product-id
    // WooCommerce: single_add_to_cart_button, woocommerce-cart, product_title
    // Prestashop: add_to_cart, product_images_container, blockcart
    classes: [
      'product-form', 'shopify-payment-button', 'product_title',
      'single_add_to_cart_button', 'woocommerce-cart', 'woocommerce-page',
      'add_to_cart', 'blockcart', 'product-item', 'cart-count',
    ],
    metas: ['og:type=product', 'product:price:amount', 'product:availability', 'og:price:amount'],
    scripts: ['cdn.shopify.com', 'shopify', 'woocommerce', 'wp-content/plugins/woocommerce', 'prestashop', 'snipcart', 'ecwid', 'stripe', 'paypal', 'klarna', 'recharge', 'bold-commerce'],
    urlPatterns: ['/products/', '/collections/', '/shop/', '/product/', '/boutique/', '/panier/', '/checkout/'],
    schemaTypes: ['Product', 'Offer', 'AggregateRating', 'ItemList', 'BreadcrumbList'],
  },
  local_seo: {
    classes: ['local-business', 'address', 'phone', 'opening-hours', 'map-embed'],
    metas: ['geo.position', 'geo.placename', 'og:locality'],
    scripts: ['google-maps', 'gmb', 'locallogic'],
    urlPatterns: ['/contact/', '/about/', '/location/', '/nos-agences/'],
    schemaTypes: ['LocalBusiness', 'PostalAddress', 'GeoCoordinates', 'OpeningHoursSpecification'],
  },
  marketing_agency: {
    classes: ['case-study', 'testimonial', 'services', 'portfolio', 'client-logo'],
    metas: ['og:type=website', 'description'],
    scripts: ['hubspot', 'marketo', 'pardot', 'intercom', 'hotjar'],
    urlPatterns: ['/services/', '/case-studies/', '/portfolio/', '/clients/'],
    schemaTypes: ['Organization', 'Service', 'Review', 'FAQPage'],
  },
};

/**
 * Calcule un score de similarité footprint entre 0 et 100
 */
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

  // Scripts tiers (poids 25) — check src URLs ET thirdParty inline
  maxScore += 25;
  const allScripts = [
    ...(extractedFp.scripts || []),
    ...(extractedFp.thirdParty || []),
  ];
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

  // Bonus plateforme : signal fort indépendant du CSS (Shopify headless, WooCommerce, etc.)
  const platformSignals = {
    ecommerce: ['shopify', 'woocommerce', 'prestashop', 'snipcart', 'ecwid'],
    seo_blog: ['rank-math', 'yoast'],
    local_seo: ['google-maps', 'gmb'],
    marketing_agency: ['hubspot', 'marketo', 'pardot'],
  };
  const platformBonus = (platformSignals[nicheName] || []).some(p =>
    (extractedFp.thirdParty || []).includes(p)
  ) ? 20 : 0;

  return Math.min(100, Math.round((score / maxScore) * 100) + platformBonus);
}

export function isParked(html, title = '') {
  if (PARKING_PATTERNS.some(p => p.test(html) || p.test(title))) return true;
  // Page trop courte = parking
  return html.replace(/<[^>]+>/g, '').trim().length < 200;
}

export function isParkingIp(ip) {
  return PARKING_IPS.has(ip?.slice(0, ip.lastIndexOf('.') + 1));
}

/**
 * Extrait une empreinte structurelle complète du HTML
 */
export function extractFullFootprint(html, url) {
  const fp = {
    classes: [],
    ids: [],
    scripts: [],
    schemaTypes: [],
    metaTags: {},
    urlPatterns: [],
    thirdParty: [],
  };

  // Classes CSS (top 50 les plus fréquentes)
  const classMatches = [...html.matchAll(/class="([^"]+)"/g)];
  const classFreq = {};
  for (const m of classMatches) {
    for (const c of m[1].split(' ')) {
      if (c.length > 3) classFreq[c] = (classFreq[c] || 0) + 1;
    }
  }
  // Filtre les classes générées (css-in-js, hash-based)
  fp.classes = Object.entries(classFreq)
    .filter(([c]) => !(/^(css-|sc-|_|[a-z]+-[0-9a-f]{5,}$|chakra-|emotion-)/.test(c)) && c.length > 4)
    .sort((a, b) => b[1] - a[1]).slice(0, 50).map(([c]) => c);

  // IDs significatifs
  fp.ids = [...new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]))].slice(0, 20);

  // Scripts tiers
  const scriptSrcs = [...html.matchAll(/src="(https?:\/\/[^"]+\.js[^"]*)"/gi)].map(m => m[1]);
  fp.scripts = [...new Set(scriptSrcs)].slice(0, 20);

  // Scripts inline connus
  if (/gtag|google-analytics/i.test(html)) fp.thirdParty.push('google-analytics');
  if (/fbq|facebook\.net/i.test(html)) fp.thirdParty.push('facebook-pixel');
  if (/\_hsq|hubspot/i.test(html)) fp.thirdParty.push('hubspot');
  if (/intercom/i.test(html)) fp.thirdParty.push('intercom');
  if (/hotjar/i.test(html)) fp.thirdParty.push('hotjar');
  // Plateformes e-commerce — détection via CDN/config inline
  if (/cdn\.shopify\.com|Shopify\.theme|shopify\.com\/s\//i.test(html)) fp.thirdParty.push('shopify');
  if (/wp-content\/plugins\/woocommerce|woocommerce\.min\.js/i.test(html)) fp.thirdParty.push('woocommerce');
  if (/prestashop|presta-/i.test(html)) fp.thirdParty.push('prestashop');
  if (/snipcart/i.test(html)) fp.thirdParty.push('snipcart');
  if (/ecwid/i.test(html)) fp.thirdParty.push('ecwid');
  if (/ReChargeWidget|recharge\.com/i.test(html)) fp.thirdParty.push('recharge');
  if (/bold-commerce|boldapps\.net/i.test(html)) fp.thirdParty.push('bold-commerce');
  if (/klarna/i.test(html)) fp.thirdParty.push('klarna');
  if (/stripe\.js|js\.stripe\.com/i.test(html)) fp.thirdParty.push('stripe');
  if (/clarity\.ms/i.test(html)) fp.thirdParty.push('clarity');
  if (/rank.?math/i.test(html)) fp.thirdParty.push('rank-math');
  if (/yoast/i.test(html)) fp.thirdParty.push('yoast');

  // Schema.org types
  const schemas = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  fp.schemaTypes = [...new Set(schemas)];

  // Meta tags
  const metas = [...html.matchAll(/<meta[^>]+(?:name|property)="([^"]+)"[^>]+content="([^"]+)"/gi)];
  for (const m of metas) fp.metaTags[m[1]] = m[2].slice(0, 100);

  // URL patterns extraits des liens internes
  try {
    const base = new URL(url);
    const links = [...html.matchAll(/href="(\/[^"]+)"/g)].map(m => m[1]);
    const pathSegments = new Set(links.map(l => '/' + l.split('/').filter(Boolean)[0]).filter(Boolean));
    fp.urlPatterns = [...pathSegments].slice(0, 20);
  } catch { /* skip */ }

  return fp;
}
