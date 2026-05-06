# Architettura CRM Aito Business

## Moduli

1. `Onboarding LinkedIn`
   Importa file CSV e JSON estratti da LinkedIn.
2. `Contatti`
   Gestisce anagrafica, classificazione, priorita e offerte collegate.
3. `Pipeline`
   Vista Kanban persistente sugli stati commerciali definitivi.
4. `Offerte`
   Catalogo offerte azienda e partner, collegate ai contatti.
5. `Suggerimenti AI`
   Genera prossima azione e messaggio da copiare.

## API principali

- `GET /api/contatti`
- `GET /api/contatti/:id`
- `PATCH /api/contatti/:id`
- `GET /api/pipeline`
- `GET /api/offerte`
- `POST /api/import`
- `POST /api/reset`
- `GET /api/metadati`
- `GET /api/prompt-ai`
- `GET /api/suggerimenti-ai`
- `POST /api/ai/genera`

## Schema dati contatto

```json
{
  "id": "string",
  "nome": "string",
  "ruolo": "string",
  "azienda": "string",
  "localita": "string",
  "settore": "string",
  "punteggioLead": 0,
  "stato": "Non in target | Da contattare | Contattato | Follow-up call effettuata | Follow-up post call | KO | Abbonato | Disdettato",
  "tipologiaContatto": "Potenziale Cliente | Potenziale Partner",
  "livelloPriorita": "Alta | Media | Bassa",
  "offerteProposteIds": ["string"],
  "offerteSottoscritteIds": ["string"],
  "timeline": [
    {
      "id": "string",
      "tipo": "string",
      "data": "YYYY-MM-DD",
      "testo": "string"
    }
  ]
}
```

## Schema dati offerta

```json
{
  "id": "string",
  "nome": "string",
  "descrizione": "string",
  "prezzo": "string",
  "tipologia": "azienda | partner",
  "percentualePartner": "string"
}
```

## Logica classificazione contatti

- `Potenziale Cliente`
  Ruoli come CEO, Founder, Head, Sales, Growth, Marketing, Operations.
- `Potenziale Partner`
  Aziende o ruoli con segnali tipo agenzia, studio, consulenza, advisor, partner, freelance.

## Logica matching offerte

- Contatti classificati come `Potenziale Partner`
  Ricevono offerte partnership.
- Contatti classificati come `Potenziale Cliente`
  Ricevono offerte commerciali aziendali.
- Settore SaaS o Tech
  Riceve anche proposta abbonamento.
