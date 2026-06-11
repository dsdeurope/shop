# SECURITY.md — V35 Shop.Zenitlab

## Architecture de sécurité

### Secrets
- Aucun secret/clé API en dur dans le code.
- Variables d'environnement exclusivement via `wrangler secret put` ou GitHub Secrets.
- `PROXY_LIST` : liste JSON chiffrée, jamais loguée en clair.
- `CF_API_TOKEN` : scope minimal (Workers Deploy uniquement).

### Rotation de proxys
- Rotation aléatoire à chaque requête via `lib/stealth.js`.
- En cas de détection ban (403/429/451/captcha), la Sentinelle déclenche une rotation forcée immédiate.
- Délai minimum entre requêtes géré par l'Optimiseur (configurable, min 1s).

### Auto-pause
- Seuil : taux d'erreur > 10% sur une fenêtre glissante de 1h.
- Action : pause automatique 30min, alerte dans `LOGS` KV.
- Reprise : automatique après expiration, ou manuelle via `wrangler kv:key delete config:{worker}:paused`.

### Filtrage contenu pollué
- Blacklist stricte : casino, pharma, adulte, gambling, xxxxx.
- Appliquée en sortie Radar ET en entrée BacklinkHunter.

## Journal des événements sécurité

> Les événements sont automatiquement écrits ici par l'Agent Sentinelle.
> Format : `[timestamp] Threats: [...] | Actions: [...]`

<!-- SENTINELLE_LOG_START -->
<!-- SENTINELLE_LOG_END -->
