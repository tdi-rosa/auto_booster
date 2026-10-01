# WikiMaster Auto backend

Backend serverless de la PWA WikiMaster Auto.

## Fonctions

- appairage temporaire d'un compte WikiMasters ;
- aucun mot de passe WikiMasters stocké ;
- renouvellement de la session Supabase ;
- chiffrement AES-256-GCM de la session avant stockage ;
- ouverture des boosters côté serveur ;
- historique partagé ;
- planification des ouvertures ;
- Web Push Android / iPhone.

## Hébergement prévu

Vercel Functions + Upstash Redis.

## Variables Vercel

- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`
- `SUPABASE_ANON_KEY`
- `SESSION_ENCRYPTION_KEY`
- `CRON_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT` (par exemple `mailto:admin@example.com`)

Générer les secrets :

```bash
openssl rand -hex 32
npx web-push generate-vapid-keys
```

Le `CRON_SECRET` doit aussi être enregistré dans GitHub sous
`WMA_CRON_SECRET`.

L'URL Vercel finale doit être enregistrée dans GitHub sous
`WMA_BACKEND_URL`.

## Routes

Toutes les routes passent par :

`/api/wma?action=...`

Actions :

- `health`
- `vapid-key`
- `pair-start`
- `pair-complete`
- `status`
- `settings`
- `history`
- `open-now`
- `push-subscribe`
- `disconnect`
- `cron`

## Appairage

La PWA génère un code temporaire. L'utilisateur se connecte normalement sur
WikiMasters puis lance le favori de connexion fourni par la PWA depuis le
domaine WikiMasters. Celui-ci transmet uniquement le refresh token de la
session et le code temporaire.

Le refresh token est immédiatement utilisé pour renouveler la session, puis la
session résultante est chiffrée avant d'être enregistrée.

Ne jamais logger de cookie, access token ou refresh token.
