# V35 — shop.zenitlab.net

Infrastructure de prospection SEO autonome sur Cloudflare.

## Architecture

```
Workers (exécution)          Agents (décision)
├── radar                    ├── sentinelle    (sécurité/ban detection)
├── backlink-hunter          ├── optimiseur    (rate limiting dynamique)
├── domain-health-checker    └── sequenceur    (maillage silos SEO)
└── dashboard-api
```

## Setup rapide

```bash
npm install
npm run kv:setup                    # Crée les namespaces KV
npm run secret:proxies              # Injecte PROXY_LIST (JSON array)
```

Ajouter dans GitHub Secrets :
- `CF_API_TOKEN` — token Cloudflare (scope: Workers Deploy)
- `CF_ACCOUNT_ID` — ID compte Cloudflare
- `PROXY_LIST` — `["http://user:pass@host:port", ...]`

Puis `git push main` → GitHub Actions déploie tout automatiquement.

## Dashboard

`https://shop.zenitlab.net` — rafraîchissement 30s, alertes auto-pause visibles.

## Sécurité

Voir `SECURITY.md` — journal auto-alimenté par l'Agent Sentinelle.