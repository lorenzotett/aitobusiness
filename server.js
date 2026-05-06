const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { randomUUID } = require("crypto");
const {
  STATI_PIPELINE,
  OFFERTE_PREDEFINITE,
  CONTATTI_PREDEFINITI,
  promptAi,
  today,
  arricchisciContatto,
  riepilogaContatti,
  costruisciPipeline,
  trovaOfferta,
  generaSuggerimentoAi
} = require("./lib/crm");
const {
  assicuraStorage,
  leggiContatti,
  salvaContatti,
  leggiImportazioniLinkedin,
  salvaImportazioniLinkedin,
  leggiImpostazioniAi,
  salvaImpostazioniAi,
  creaUtente,
  trovaUtentePerEmail,
  trovaUtentePerId,
  salvaSessione,
  trovaSessionePerHash,
  eliminaSessionePerHash,
  listaUtentiAdmin,
  riepilogoUtentiAdmin
} = require("./lib/storage");
const {
  cifraValore,
  normalizzaImpostazioniAi,
  serializzaImpostazioniAiPerClient
} = require("./lib/ai-provider");
const {
  COOKIE_SESSIONE,
  verificaPassword,
  generaTokenSessione,
  hashTokenSessione,
  creaCookieSessione,
  creaCookieLogout,
  leggiCookie,
  creaUtentePayload,
  creaSessionePayload
} = require("./lib/auth");
const {
  LIMITE_DIMENSIONE_ZIP,
  validaNomeFileZip,
  validaMagicBytesZip,
  creaJobImportazione,
  aggiornaStatoJob,
  parseMultipartZip,
  processaArchivioLinkedin,
  serializzaRecordAnteprima,
  applicaOverrideRecord,
  importaRecordsNelCrm
} = require("./lib/importazioni-linkedin");

const PORTA = process.env.PORT || 3000;
const cartellaPubblica = path.join(__dirname, "public");
const GLOBAL_AI_USER_ID = "__global__";

assicuraStorage(CONTATTI_PREDEFINITI);

function assicuraBootstrapProduzione() {
  const adminEmail = process.env.ADMIN_EMAIL || "";
  const adminPassword = process.env.ADMIN_PASSWORD || "";
  if (adminEmail && adminPassword && !trovaUtentePerEmail(adminEmail)) {
    const utente = creaUtentePayload({
      email: adminEmail,
      nome: process.env.ADMIN_NAME || "Admin",
      password: adminPassword,
      ruolo: "admin"
    });
    creaUtente(utente);
    salvaContatti(CONTATTI_PREDEFINITI, utente.id);
  }

  const defaultGroqKey = process.env.DEFAULT_GROQ_API_KEY || "";
  if (defaultGroqKey) {
    const existing = leggiImpostazioniAi().find((record) => record.userId === GLOBAL_AI_USER_ID);
    if (!existing) {
      const now = new Date().toISOString();
      salvaImpostazioniAi([
        ...leggiImpostazioniAi(),
        {
          id: GLOBAL_AI_USER_ID,
          userId: GLOBAL_AI_USER_ID,
          ...normalizzaImpostazioniAi({
            provider: "groq",
            endpoint: "https://api.groq.com/openai/v1/chat/completions",
            modello: process.env.DEFAULT_GROQ_MODEL || "llama-3.3-70b-versatile",
            temperatura: Number(process.env.DEFAULT_GROQ_TEMPERATURE || 0.2),
            maxToken: Number(process.env.DEFAULT_GROQ_MAX_TOKENS || 600),
            limiteCrediti: Number(process.env.DEFAULT_GROQ_CREDIT_LIMIT || 120),
            creditiResidui: Number(process.env.DEFAULT_GROQ_CREDIT_LIMIT || 120),
            creditiConsumati: 0
          }),
          apiKeyEncrypted: cifraValore(defaultGroqKey),
          apiKeyPreview: defaultGroqKey,
          createdAt: now,
          updatedAt: now
        }
      ]);
    }
  }
}

assicuraBootstrapProduzione();

function ricavaUtenteSessione(req) {
  const token = leggiCookie(req, COOKIE_SESSIONE);
  if (!token) return null;
  const sessione = trovaSessionePerHash(hashTokenSessione(token));
  if (!sessione) return null;
  if (new Date(sessione.expires_at).getTime() < Date.now()) {
    eliminaSessionePerHash(sessione.token_hash);
    return null;
  }
  return trovaUtentePerId(sessione.user_id);
}

function richiedeAutenticazione(pathname) {
  return pathname.startsWith("/api/") && !pathname.startsWith("/api/auth/");
}

function utenteEAdmin(utente) {
  return ["admin", "owner"].includes(String(utente?.ruolo || "").toLowerCase());
}

function payloadSessione(utente) {
  return utente
    ? {
        autenticato: true,
        utente: {
          id: utente.id,
          email: utente.email,
          nome: utente.nome,
          ruolo: utente.ruolo
        }
      }
    : { autenticato: false, utente: null };
}

function trovaImpostazioniAiUtente(userId) {
  const lista = leggiImpostazioniAi();
  return lista.find((record) => record.userId === userId) || lista.find((record) => record.userId === GLOBAL_AI_USER_ID) || null;
}

function salvaImpostazioniAiUtente(userId, payload) {
  const lista = leggiImpostazioniAi().filter((record) => record.userId !== userId);
  const base = normalizzaImpostazioniAi(payload);
  const esistente = trovaImpostazioniAiUtente(userId);
  const ereditaDaGlobale = esistente?.userId === GLOBAL_AI_USER_ID;
  const apiKey = typeof payload.apiKey === "string" ? payload.apiKey.trim() : "";
  const record = {
    id: ereditaDaGlobale ? userId : esistente?.id || userId,
    userId,
    ...base,
    apiKeyEncrypted: apiKey ? cifraValore(apiKey) : esistente?.apiKeyEncrypted || null,
    apiKeyPreview: apiKey || esistente?.apiKeyPreview || "",
    createdAt: ereditaDaGlobale ? new Date().toISOString() : esistente?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  lista.push(record);
  salvaImpostazioniAi(lista);
  return record;
}

function leggiJobUtente(jobId, userId) {
  return leggiImportazioniLinkedin(userId).find((job) => job.id === jobId && job.userId === userId) || null;
}

function salvaJob(job) {
  const jobs = leggiImportazioniLinkedin().filter((item) => item.id !== job.id);
  jobs.push(job);
  salvaImportazioniLinkedin(jobs);
  return job;
}

function inviaJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY"
  });
  res.end(JSON.stringify(payload));
}

function inviaErrore(res, statusCode, codice, messaggio) {
  inviaJson(res, statusCode, { errore: codice, messaggio });
}

function inviaFile(res, percorsoFile) {
  const ext = path.extname(percorsoFile);
  const mime = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  };

  fs.readFile(percorsoFile, (errore, data) => {
    if (errore) {
      inviaErrore(res, 404, "FILE_NOT_FOUND", "File non trovato");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[ext] || "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY"
    });
    res.end(data);
  });
}

function leggiBodyJson(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (_errore) {
        reject(new Error("JSON_NON_VALIDO"));
      }
    });
    req.on("error", reject);
  });
}

function payloadJob(job) {
  return {
    id: job.id,
    status: job.status,
    originalFileName: job.originalFileName,
    fileSize: job.fileSize,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    errorMessage: job.errorMessage,
    totalFilesFound: job.totalFilesFound,
    totalContactsFound: job.totalContactsFound,
    totalConversationsFound: job.totalConversationsFound,
    totalRecordsAnalyzed: job.totalRecordsAnalyzed,
    totalContactsCreated: job.totalContactsCreated,
    totalContactsUpdated: job.totalContactsUpdated,
    totalDuplicatesFound: job.totalDuplicatesFound,
    totalErrors: job.totalErrors,
    metadata: job.metadata
  };
}

function payloadAnteprima(job) {
  const daConnessioni = job.records.filter((record) => record.sourceKind === "connections");
  const daImported = job.records.filter((record) => record.sourceKind === "imported_contacts");
  const esclusiAuto = job.records.filter((record) => record.status === "excluded" || record.exclude);
  return {
    job: payloadJob(job),
    riepilogo: {
      nuovi: job.records.filter((record) => !record.matchedContactId).length,
      duplicati: job.records.filter((record) => record.status === "duplicate").length,
      daRevisionare: job.records.filter((record) => record.status === "needs_review").length,
      errori: job.records.filter((record) => record.status === "failed").length,
      connections: daConnessioni.length,
      importedContacts: daImported.length,
      esclusiAuto: esclusiAuto.length
    },
    records: job.records.map(serializzaRecordAnteprima)
  };
}

const rotteApplicazione = [
  "/",
  "/accesso",
  "/registrati",
  "/admin/login",
  "/admin",
  "/dashboard",
  "/contatti",
  "/pipeline",
  "/offerte",
  "/analytics",
  "/onboarding",
  "/importa-linkedin",
  "/suggerimenti-ai"
];
const rotteLegacy = ["/contacts", "/upload", "/offers", "/ai-suggestions", "/segments"];

async function app(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const utente = ricavaUtenteSessione(req);

  if (pathname === "/api/auth/session" && req.method === "GET") {
    inviaJson(res, 200, payloadSessione(utente));
    return;
  }

  if (pathname === "/api/health" && req.method === "GET") {
    inviaJson(res, 200, {
      ok: true,
      service: "aito-business-crm",
      environment: process.env.NODE_ENV || "development",
      storage: "sqlite",
      timestamp: new Date().toISOString()
    });
    return;
  }

  if (pathname === "/api/auth/register" && req.method === "POST") {
    try {
      const body = await leggiBodyJson(req);
      if (!body.email || !body.password) {
        inviaErrore(res, 400, "AUTH_INVALID", "Email e password sono obbligatori.");
        return;
      }
      if (trovaUtentePerEmail(body.email)) {
        inviaErrore(res, 409, "AUTH_EXISTS", "Esiste già un account con questa email.");
        return;
      }
      const nuovoUtente = creaUtentePayload({
        email: body.email,
        nome: body.nome,
        password: body.password
      });
      creaUtente(nuovoUtente);
      salvaContatti(CONTATTI_PREDEFINITI, nuovoUtente.id);

      const token = generaTokenSessione();
      salvaSessione(creaSessionePayload(nuovoUtente.id, token));
      res.setHeader("Set-Cookie", creaCookieSessione(token));
      inviaJson(res, 201, payloadSessione(nuovoUtente));
    } catch (_errore) {
      inviaErrore(res, 400, "AUTH_REGISTER_FAILED", "Registrazione non riuscita.");
    }
    return;
  }

  if (pathname === "/api/auth/login" && req.method === "POST") {
    try {
      const body = await leggiBodyJson(req);
      const userRecord = trovaUtentePerEmail(body.email || "");
      if (!userRecord || !verificaPassword(body.password || "", userRecord.password_hash)) {
        inviaErrore(res, 401, "AUTH_INVALID_CREDENTIALS", "Credenziali non valide.");
        return;
      }
      const token = generaTokenSessione();
      salvaSessione(creaSessionePayload(userRecord.id, token));
      res.setHeader("Set-Cookie", creaCookieSessione(token));
      inviaJson(res, 200, payloadSessione({
        id: userRecord.id,
        email: userRecord.email,
        nome: userRecord.nome,
        ruolo: userRecord.ruolo
      }));
    } catch (_errore) {
      inviaErrore(res, 400, "AUTH_LOGIN_FAILED", "Login non riuscito.");
    }
    return;
  }

  if (pathname === "/api/auth/admin-login" && req.method === "POST") {
    try {
      const body = await leggiBodyJson(req);
      const userRecord = trovaUtentePerEmail(body.email || "");
      if (!userRecord || !verificaPassword(body.password || "", userRecord.password_hash)) {
        inviaErrore(res, 401, "AUTH_INVALID_CREDENTIALS", "Credenziali non valide.");
        return;
      }
      if (!utenteEAdmin(userRecord)) {
        inviaErrore(res, 403, "ADMIN_REQUIRED", "Questo accesso e riservato all'amministrazione.");
        return;
      }
      const token = generaTokenSessione();
      salvaSessione(creaSessionePayload(userRecord.id, token));
      res.setHeader("Set-Cookie", creaCookieSessione(token));
      inviaJson(res, 200, payloadSessione({
        id: userRecord.id,
        email: userRecord.email,
        nome: userRecord.nome,
        ruolo: userRecord.ruolo
      }));
    } catch (_errore) {
      inviaErrore(res, 400, "AUTH_LOGIN_FAILED", "Login amministratore non riuscito.");
    }
    return;
  }

  if (pathname === "/api/auth/logout" && req.method === "POST") {
    const token = leggiCookie(req, COOKIE_SESSIONE);
    if (token) {
      eliminaSessionePerHash(hashTokenSessione(token));
    }
    res.setHeader("Set-Cookie", creaCookieLogout());
    inviaJson(res, 200, { ok: true });
    return;
  }

  if (richiedeAutenticazione(pathname) && !utente) {
    inviaErrore(res, 401, "AUTH_REQUIRED", "Accedi per usare la piattaforma.");
    return;
  }

  const userId = utente?.id;
  const contatti = utente ? leggiContatti(userId).map(arricchisciContatto) : [];

  if (pathname === "/api/metadati" && req.method === "GET") {
    inviaJson(res, 200, {
      statiPipeline: STATI_PIPELINE,
      offerte: OFFERTE_PREDEFINITE,
      limiteZipBytes: LIMITE_DIMENSIONE_ZIP,
      auth: payloadSessione(utente)
    });
    return;
  }

  if (pathname === "/api/admin/utenti" && req.method === "GET") {
    if (!utenteEAdmin(utente)) {
      inviaErrore(res, 403, "ADMIN_REQUIRED", "Accesso amministratore richiesto.");
      return;
    }
    inviaJson(res, 200, {
      riepilogo: riepilogoUtentiAdmin(),
      utenti: listaUtentiAdmin()
    });
    return;
  }

  if (pathname === "/api/impostazioni/ai-provider" && req.method === "GET") {
    inviaJson(res, 200, {
      impostazioni: serializzaImpostazioniAiPerClient(trovaImpostazioniAiUtente(userId) || {})
    });
    return;
  }

  if (pathname === "/api/impostazioni/ai-provider" && req.method === "POST") {
    try {
      const body = await leggiBodyJson(req);
      const record = salvaImpostazioniAiUtente(userId, body);
      inviaJson(res, 200, {
        impostazioni: serializzaImpostazioniAiPerClient(record)
      });
    } catch (_errore) {
      inviaErrore(res, 400, "AI_SETTINGS_INVALID", "Configurazione AI non valida");
    }
    return;
  }

  if (pathname === "/api/importazioni/linkedin/upload" && req.method === "POST") {
    let job = null;
    try {
      const upload = await parseMultipartZip(req);
      if (!validaNomeFileZip(upload.nomeFile)) {
        inviaErrore(res, 400, "ZIP_FILE_REQUIRED", "Carica un archivio .zip esportato da LinkedIn.");
        return;
      }
      if (!validaMagicBytesZip(upload.buffer)) {
        inviaErrore(res, 400, "ZIP_INVALID", "Il file caricato non sembra un archivio ZIP valido.");
        return;
      }

      job = creaJobImportazione({
        userId,
        nomeFileOriginale: upload.nomeFile,
        dimensioneFile: upload.buffer.length
      });
      salvaJob(job);

      const impostazioniAi = trovaImpostazioniAiUtente(userId);
      job = await processaArchivioLinkedin({
        job,
        bufferZip: upload.buffer,
        contattiEsistenti: contatti,
        impostazioniAi
      });
      if (impostazioniAi) {
        salvaImpostazioniAiUtente(userId, impostazioniAi);
      }
      salvaJob(job);

      inviaJson(res, 200, payloadAnteprima(job));
    } catch (errore) {
      if (job) {
        aggiornaStatoJob(job, "failed", {
          errorMessage: errore.message
        });
        salvaJob(job);
      }

      const mappaErrori = {
        ZIP_TOO_LARGE: ["ZIP_TOO_LARGE", `Archivio troppo grande. Limite: ${Math.round(LIMITE_DIMENSIONE_ZIP / 1024 / 1024)} MB.`],
        ZIP_INVALID: ["ZIP_INVALID", "Il file ZIP non e valido o e corrotto."],
        ZIP_EMPTY: ["ZIP_EMPTY", "L'archivio ZIP e vuoto."],
        ZIP_PATH_TRAVERSAL: ["ZIP_PATH_TRAVERSAL", "Archivio non sicuro: contiene percorsi non validi."],
        UPLOAD_MULTIPART_INVALID: ["UPLOAD_MULTIPART_INVALID", "Upload non valido. Riprova selezionando il file ZIP."],
        UPLOAD_FILE_MISSING: ["UPLOAD_FILE_MISSING", "Nessun file ricevuto nella richiesta."],
        LINKEDIN_DATA_NOT_FOUND: ["LINKEDIN_DATA_NOT_FOUND", "Non ho trovato contatti o conversazioni utili dentro l'archivio LinkedIn."]
      };
      const [codice, messaggio] = mappaErrori[errore.message] || ["LINKEDIN_IMPORT_FAILED", "Importazione LinkedIn non riuscita."];
      inviaErrore(res, 400, codice, messaggio);
    }
    return;
  }

  const matchStatoImport = pathname.match(/^\/api\/importazioni\/linkedin\/([^/]+)\/stato$/);
  if (matchStatoImport && req.method === "GET") {
    const job = leggiJobUtente(matchStatoImport[1], userId);
    if (!job) {
      inviaErrore(res, 404, "IMPORT_JOB_NOT_FOUND", "Importazione non trovata.");
      return;
    }
    inviaJson(res, 200, payloadJob(job));
    return;
  }

  const matchAnteprimaImport = pathname.match(/^\/api\/importazioni\/linkedin\/([^/]+)\/anteprima$/);
  if (matchAnteprimaImport && req.method === "GET") {
    const job = leggiJobUtente(matchAnteprimaImport[1], userId);
    if (!job) {
      inviaErrore(res, 404, "IMPORT_JOB_NOT_FOUND", "Importazione non trovata.");
      return;
    }
    inviaJson(res, 200, payloadAnteprima(job));
    return;
  }

  const matchConfermaImport = pathname.match(/^\/api\/importazioni\/linkedin\/([^/]+)\/conferma$/);
  if (matchConfermaImport && req.method === "POST") {
    try {
      const job = leggiJobUtente(matchConfermaImport[1], userId);
      if (!job) {
        inviaErrore(res, 404, "IMPORT_JOB_NOT_FOUND", "Importazione non trovata.");
        return;
      }
      if (job.status === "completed") {
        inviaErrore(res, 409, "IMPORT_ALREADY_CONFIRMED", "Questa importazione e gia stata confermata.");
        return;
      }
      const body = await leggiBodyJson(req);
      const overrides = Array.isArray(body.records) ? body.records : [];
      const mappaOverride = new Map(overrides.map((record) => [record.id, record]));
      job.records = job.records.map((record) => applicaOverrideRecord(record, mappaOverride.get(record.id)));

      aggiornaStatoJob(job, "importing");
      const esito = importaRecordsNelCrm({
        contattiEsistenti: contatti,
        records: job.records
      });
      salvaContatti(esito.contatti, userId);

      job.totalContactsCreated = esito.creati;
      job.totalContactsUpdated = esito.modificati;
      aggiornaStatoJob(job, "completed");
      salvaJob(job);

      inviaJson(res, 200, {
        job: payloadJob(job),
        contatti: esito.contatti,
        riepilogo: riepilogaContatti(esito.contatti.map(arricchisciContatto))
      });
    } catch (_errore) {
      inviaErrore(res, 400, "IMPORT_CONFIRM_FAILED", "Conferma importazione non riuscita.");
    }
    return;
  }

  const matchAnnullaImport = pathname.match(/^\/api\/importazioni\/linkedin\/([^/]+)\/annulla$/);
  if (matchAnnullaImport && req.method === "POST") {
    const job = leggiJobUtente(matchAnnullaImport[1], userId);
    if (!job) {
      inviaErrore(res, 404, "IMPORT_JOB_NOT_FOUND", "Importazione non trovata.");
      return;
    }
    aggiornaStatoJob(job, "cancelled");
    salvaJob(job);
    inviaJson(res, 200, { job: payloadJob(job) });
    return;
  }

  if (pathname === "/api/contatti" && req.method === "GET") {
    inviaJson(res, 200, { contatti, riepilogo: riepilogaContatti(contatti) });
    return;
  }

  if (pathname === "/api/pipeline" && req.method === "GET") {
    inviaJson(res, 200, { pipeline: costruisciPipeline(contatti), statiPipeline: STATI_PIPELINE });
    return;
  }

  if (pathname === "/api/offerte" && req.method === "GET") {
    const offerte = OFFERTE_PREDEFINITE.map((offerta) => ({
      ...offerta,
      contattiProposti: contatti.filter((contatto) => (contatto.offerteProposteIds || []).includes(offerta.id)).length,
      contattiSottoscritti: contatti.filter((contatto) => (contatto.offerteSottoscritteIds || []).includes(offerta.id)).length
    }));
    inviaJson(res, 200, { offerte });
    return;
  }

  if (pathname.startsWith("/api/contatti/") && req.method === "GET") {
    const id = pathname.split("/").pop();
    const contatto = contatti.find((item) => item.id === id);
    if (!contatto) {
      inviaErrore(res, 404, "CONTACT_NOT_FOUND", "Contatto non trovato");
      return;
    }
    inviaJson(res, 200, {
      contatto,
      offerteProposte: (contatto.offerteProposteIds || []).map(trovaOfferta).filter(Boolean),
      offerteSottoscritte: (contatto.offerteSottoscritteIds || []).map(trovaOfferta).filter(Boolean)
    });
    return;
  }

  if (pathname.startsWith("/api/contatti/") && req.method === "PATCH") {
    try {
      const id = pathname.split("/").pop();
      const body = await leggiBodyJson(req);
      const esiste = contatti.find((item) => item.id === id);
      if (!esiste) {
        inviaErrore(res, 404, "CONTACT_NOT_FOUND", "Contatto non trovato");
        return;
      }

      const prossimiContatti = contatti.map((contatto) => {
        if (contatto.id !== id) return contatto;
        return arricchisciContatto({
          ...contatto,
          ...body,
          offerteProposteIds: body.offerteProposteIds || contatto.offerteProposteIds,
          offerteSottoscritteIds: body.offerteSottoscritteIds || contatto.offerteSottoscritteIds,
          timeline: body.aggiungiEventoTimeline
            ? [
                ...contatto.timeline,
                {
                  id: randomUUID(),
                  tipo: body.aggiungiEventoTimeline.tipo || "nota",
                  data: body.aggiungiEventoTimeline.data || today(),
                  testo: body.aggiungiEventoTimeline.testo || ""
                }
              ]
            : contatto.timeline
        });
      });

      salvaContatti(prossimiContatti, userId);
      const contattoAggiornato = prossimiContatti.find((contatto) => contatto.id === id);
      inviaJson(res, 200, { contatto: contattoAggiornato, riepilogo: riepilogaContatti(prossimiContatti) });
    } catch (_errore) {
      inviaErrore(res, 400, "CONTACT_UPDATE_INVALID", "Payload aggiornamento non valido");
    }
    return;
  }

  if (pathname === "/api/import" && req.method === "POST") {
    try {
      const body = await leggiBodyJson(req);
      const nuoviContatti = Array.isArray(body.contatti) ? body.contatti : [];
      if (!nuoviContatti.length) {
        inviaErrore(res, 400, "IMPORT_EMPTY", "Nessun contatto trovato nel file");
        return;
      }
      const normalizzati = nuoviContatti.map(arricchisciContatto);
      const mappa = new Map();
      [...contatti, ...normalizzati].forEach((contattoCorrente) => {
        const chiave = `${contattoCorrente.nome.toLowerCase()}|${contattoCorrente.azienda.toLowerCase()}`;
        mappa.set(chiave, contattoCorrente);
      });
      const unificati = Array.from(mappa.values());
      salvaContatti(unificati, userId);
      inviaJson(res, 200, {
        importati: normalizzati.length,
        totale: unificati.length,
        contatti: unificati,
        riepilogo: riepilogaContatti(unificati)
      });
    } catch (_errore) {
      inviaErrore(res, 400, "IMPORT_INVALID", "Payload import non valido");
    }
    return;
  }

  if (pathname === "/api/reset" && req.method === "POST") {
    salvaContatti(CONTATTI_PREDEFINITI, userId);
    inviaJson(res, 200, {
      contatti: CONTATTI_PREDEFINITI.map(arricchisciContatto),
      riepilogo: riepilogaContatti(CONTATTI_PREDEFINITI.map(arricchisciContatto))
    });
    return;
  }

  if (pathname === "/api/prompt-ai" && req.method === "GET") {
    inviaJson(res, 200, promptAi);
    return;
  }

  if (pathname === "/api/suggerimenti-ai" && req.method === "GET") {
    const suggerimenti = contatti
      .map((contatto) => ({
        contattoId: contatto.id,
        nome: contatto.nome,
        azienda: contatto.azienda,
        ruolo: contatto.ruolo,
        ...generaSuggerimentoAi(contatto)
      }))
      .sort((a, b) => b.punteggio - a.punteggio);
    inviaJson(res, 200, { suggerimenti });
    return;
  }

  if (pathname === "/api/ai/genera" && req.method === "POST") {
    try {
      const body = await leggiBodyJson(req);
      const contatto = contatti.find((item) => item.id === body.contattoId);
      if (!contatto) {
        inviaErrore(res, 404, "CONTACT_NOT_FOUND", "Contatto non trovato");
        return;
      }
      const suggerimento = generaSuggerimentoAi(contatto);
      const contattiAggiornati = contatti.map((item) =>
        item.id === contatto.id
          ? arricchisciContatto({
              ...item,
              stato: suggerimento.statoLead,
              insight: suggerimento.insight,
              prossimaAzione: suggerimento.prossimaAzione,
              messaggioSuggerito: suggerimento.messaggioSuggerito
            })
          : item
      );
      salvaContatti(contattiAggiornati, userId);
      inviaJson(res, 200, {
        contatto: contattiAggiornati.find((item) => item.id === contatto.id)
      });
    } catch (_errore) {
      inviaErrore(res, 400, "AI_GENERATE_INVALID", "Richiesta AI non valida");
    }
    return;
  }

  if (rotteLegacy.includes(pathname)) {
    const mappaRedirect = {
      "/contacts": "/contatti",
      "/upload": "/importa-linkedin",
      "/offers": "/offerte",
      "/ai-suggestions": "/suggerimenti-ai",
      "/segments": "/pipeline"
    };
    res.writeHead(302, { Location: mappaRedirect[pathname] || "/dashboard" });
    res.end();
    return;
  }

  if (pathname.startsWith("/public/")) {
    inviaFile(res, path.join(__dirname, pathname));
    return;
  }

  if (rotteApplicazione.includes(pathname) || /^\/contatti\/[^/]+$/.test(pathname)) {
    inviaFile(res, path.join(cartellaPubblica, "index.html"));
    return;
  }

  inviaErrore(res, 404, "NOT_FOUND", "Risorsa non trovata");
}

if (require.main === module) {
  const server = http.createServer(app);
  server.listen(PORTA, () => {
    console.log(`Aito Business CRM running on http://localhost:${PORTA}`);
  });
}

module.exports = app;
