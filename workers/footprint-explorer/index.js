/**
 * Worker: FootprintExplorer
 * Analyse HTML/CSS des sites leaders → génère des dorks de recherche
 * et découvre des opportunités par empreinte digitale.
 */

import { buildFetchOptions } from '../../lib/stealth.js';
import { isDuplicate } from '../../lib/hash.js';
import { logError, logInfo } from '../../lib/logger.js';

// Signatures d'empreinte connues → type de CMS/plateforme
const FOOTPRINT_SIGNATURES = {
  wordpress:    [/wp-content\/themes/i, /wp-includes/i, /xmlrpc\.php/i],
  drupal:       [/\/sites\/default\/files/i, /Drupal\.settings/i],
  joomla:       [/\/components\/com_/i, /Joomla!/i],
  shopify:      [/cdn\.shopify\.com/i, /Shopify\.theme/i],
  woocommerce:  [/woocommerce/i, /add-to-cart/i],
  ghost:        [/ghost\.io/i, /content\/images\/size/i],
  webflow:      [/webflow\.com\/css/i, /wf-form/i],
  prestashop:   [/prestashop/i, /\/modules\/blockcart/i],
};

// Dorks générés par plateforme
const PLATFORM_DORKS = {
  wordpress:   ['inurl:"/guest-post/" site:*.com', 'inurl:"/write-for-us/" wordpress', '"guest author" site:*.com inurl:blog'],
  drupal:      ['"add new comment" site:*.org drupal', 'inurl:node/add site:*.edu'],
  joomla:      ['"powered by joomla" "write for us"', 'inurl:index.php?option=com_content "submit article"'],
  shopify:     ['"powered by shopify" "guest post"', 'inurl:blogs/news "write for us" shopify'],
  woocommerce: ['"woocommerce" "resources" "submit" site:*.com', '"add to wishlist" "guest post guidelines"'],
  ghost:       ['"published with ghost" "write for us"', 'site:ghost.io "become a contributor"'],
  webflow:     ['"made in webflow" "contribute"', 'webflow "write for us" blog'],
  prestashop:  ['"prestashop" "partenaires" "soumettre"', '"prestashop" "guest blogging"'],
  generic:     ['"write for us" "guest post" seo', '"submit a guest post" dofollow', '"contributor guidelines" backlink'],
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing url', { status: 400 });

    try {
      const result = await exploreFootprint(target, env);
      return Response.json(result);
    } catch (err) {
      await logError(env, 'footprint-explorer', err.message, { target });
      return Response.json({ error: err.message }, { status: 500 });
    }
  },

  async scheduled(event, env) {
    // Analyse les top domaines de la queue radar
    const raw = await env.KV.get('queue:radar');
    const targets = raw ? JSON.parse(raw).slice(0, 5) : [];
    for (const t of targets) {
      try { await exploreFootprint(t, env); } catch { /* continue */ }
    }
  },
};

async function exploreFootprint(targetUrl, env) {
  const { headers, cf } = buildFetchOptions(env.PROXY_LIST);

  const resp = await fetch(targetUrl, {
    headers, cf,
    redirect: 'follow',
    signal: AbortSignal.timeout(12000),
  });

  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const html = await resp.text();

  // Détection plateforme
  const platform = detectPlatform(html);

  // Extraction empreintes structurelles
  const fingerprint = extractFingerprint(html);

  // Génération dorks
  const dorks = generateDorks(platform, fingerprint);

  // Détection formulaires de contact / soumission
  const submissionForms = detectSubmissionForms(html, targetUrl);

  // Friction : libre vs avec compte
  const friction = classifyFriction(html);

  const result = {
    url: targetUrl,
    platform,
    fingerprint,
    dorks,
    submissionForms,
    friction,
    ts: new Date().toISOString(),
  };

  // Stocke avec dédup hash
  const dup = await isDuplicate(env, `footprint:${targetUrl}`);
  if (!dup) {
    await env.KV.put(`footprint:${new URL(targetUrl).hostname}`, JSON.stringify(result));
    // Accumule les dorks générés
    const existing = JSON.parse(await env.KV.get('dorks:generated') || '[]');
    const newDorks = dorks.filter(d => !existing.includes(d));
    await env.KV.put('dorks:generated', JSON.stringify([...existing, ...newDorks].slice(0, 500)));
  }

  await logInfo(env, 'footprint-explorer', 'scan-complete', { url: targetUrl, platform, dorksCount: dorks.length });
  return result;
}

function detectPlatform(html) {
  for (const [platform, sigs] of Object.entries(FOOTPRINT_SIGNATURES)) {
    if (sigs.some(sig => sig.test(html))) return platform;
  }
  return 'generic';
}

function extractFingerprint(html) {
  const fp = {
    commentSystems: [],
    formPatterns: [],
    techStack: [],
    schemaTypes: [],
  };

  // Systèmes de commentaires
  if (/disqus/i.test(html)) fp.commentSystems.push('disqus');
  if (/commento/i.test(html)) fp.commentSystems.push('commento');
  if (/livefyre/i.test(html)) fp.commentSystems.push('livefyre');
  if (/comment-form/i.test(html)) fp.commentSystems.push('native');

  // Patterns de formulaires
  const formActions = [...html.matchAll(/action="([^"]*(?:submit|post|comment|contact|contribute)[^"]*)"/gi)]
    .map(m => m[1]).slice(0, 5);
  fp.formPatterns = formActions;

  // Stack technique
  if (/react/i.test(html)) fp.techStack.push('react');
  if (/vue/i.test(html)) fp.techStack.push('vue');
  if (/angular/i.test(html)) fp.techStack.push('angular');
  if (/next\.js|__NEXT/i.test(html)) fp.techStack.push('nextjs');
  if (/gatsby/i.test(html)) fp.techStack.push('gatsby');

  // Schema.org types
  const schemas = [...html.matchAll(/"@type"\s*:\s*"([^"]+)"/g)].map(m => m[1]);
  fp.schemaTypes = [...new Set(schemas)].slice(0, 10);

  return fp;
}

function generateDorks(platform, fingerprint) {
  const dorks = [...(PLATFORM_DORKS[platform] || PLATFORM_DORKS.generic)];

  // Dorks basés sur les schémas détectés
  if (fingerprint.schemaTypes.includes('Article')) {
    dorks.push('"Article" schema "write for us" dofollow');
  }
  if (fingerprint.schemaTypes.includes('BlogPosting')) {
    dorks.push('"BlogPosting" "guest author" site:*.com');
  }
  if (fingerprint.commentSystems.includes('disqus')) {
    dorks.push('disqus "guest post" "seo" site:*.com');
  }

  return [...new Set(dorks)];
}

function detectSubmissionForms(html, baseUrl) {
  const forms = [];
  const re = /<form[^>]*action="([^"]*)"[^>]*>([\s\S]*?)<\/form>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const action = m[1];
    const body = m[2].toLowerCase();
    if (/submit|guest|write|contrib|article/i.test(action + body)) {
      try {
        forms.push(new URL(action, baseUrl).toString());
      } catch { /* skip */ }
    }
  }
  return [...new Set(forms)].slice(0, 5);
}

function classifyFriction(html) {
  // Pose libre = formulaire visible sans login requis
  const hasFreeForm = /<form[^>]*>/i.test(html) &&
    !/(login|sign.?in|register|account required)/i.test(html);
  const requiresAccount = /(you must be logged|sign in to comment|create account|register to)/i.test(html);

  if (requiresAccount) return 'avec_compte';
  if (hasFreeForm) return 'libre';
  return 'email_contact';
}
