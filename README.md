# Aito Business CRM

Piattaforma web CRM per importare archivi LinkedIn `.zip`, analizzare contatti e conversazioni, classificarli con AI e organizzarli in pipeline commerciali.

## Funzionalità principali

- autenticazione locale con sessione cookie
- CRM contatti con pipeline, offerte, analytics e suggerimenti AI
- importazione archivio LinkedIn `.zip`
- parsing sicuro ZIP con protezione path traversal
- preview importazione con conferma finale
- Groq come provider AI predefinito compatibile OpenAI
- persistenza SQLite locale

## Avvio locale

```bash
npm start
```

Apri `http://localhost:3000`.

## Test

```bash
npm test
```

## Variabili ambiente

Usa [.env.example](C:/Users/ltett/Documents/Codex/2026-04-23-aito-business-full-product-ux-specification/.env.example) come riferimento.

Le più importanti:

- `APP_SECRET`: segreto applicativo per cifrare chiavi AI e gestire la sessione in modo sicuro
- `ADMIN_EMAIL`, `ADMIN_PASSWORD`: bootstrap automatico admin in produzione
- `DEFAULT_GROQ_API_KEY`: bootstrap globale del provider Groq
- `DEFAULT_GROQ_CREDIT_LIMIT`: limite interno crediti AI
- `LINKEDIN_IMPORT_MAX_BYTES`: limite massimo upload ZIP

## Produzione

Questa base è pronta per deploy su un host Node con storage persistente locale, per esempio Railway con volume, Render Disk o VPS/Docker.

Checklist:

1. imposta `NODE_ENV=production`
2. imposta `APP_SECRET`
3. configura `ADMIN_EMAIL` e `ADMIN_PASSWORD`
4. configura `DEFAULT_GROQ_API_KEY`
5. monta la cartella `data/` su volume persistente
6. esponi la porta `3000`

## Docker

Build:

```bash
docker build -t aito-business-crm .
```

Run:

```bash
docker run -p 3000:3000 --env-file .env -v aito_data:/app/data aito-business-crm
```

## Endpoint utili

- `GET /api/health`
- `GET /api/auth/session`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/importazioni/linkedin/upload`
- `GET /api/importazioni/linkedin/:jobId/anteprima`
- `POST /api/importazioni/linkedin/:jobId/conferma`
