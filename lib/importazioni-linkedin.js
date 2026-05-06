const path = require("path");
const zlib = require("zlib");
const { randomUUID } = require("crypto");
const {
  arricchisciContatto,
  classificaTipologiaContatto,
  calcolaPriorita,
  STATI_PIPELINE,
  today
} = require("./crm");
const { chiamaProviderAi, tentaParseJsonAi } = require("./ai-provider");

const ESTENSIONI_TESTO = new Set([".csv", ".json", ".txt"]);
const LIMITE_DIMENSIONE_ZIP = Number(process.env.LINKEDIN_IMPORT_MAX_BYTES || 30 * 1024 * 1024);

const STATI_JOB = ["uploaded", "extracting", "parsing", "analyzing", "preview_ready", "importing", "completed", "failed", "cancelled"];
const STATI_RECORD = ["pending", "analyzed", "ready", "duplicate", "needs_review", "excluded", "imported", "failed"];

function validaNomeFileZip(nomeFile) {
  return typeof nomeFile === "string" && nomeFile.toLowerCase().endsWith(".zip");
}

function validaMagicBytesZip(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return false;
  }
  return buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function creaJobImportazione({ userId, nomeFileOriginale, dimensioneFile }) {
  return {
    id: randomUUID(),
    userId,
    status: "uploaded",
    originalFileName: nomeFileOriginale,
    fileSize: dimensioneFile,
    startedAt: new Date().toISOString(),
    completedAt: null,
    errorMessage: "",
    totalFilesFound: 0,
    totalContactsFound: 0,
    totalConversationsFound: 0,
    totalRecordsAnalyzed: 0,
    totalContactsCreated: 0,
    totalContactsUpdated: 0,
    totalDuplicatesFound: 0,
    totalErrors: 0,
    metadata: {
      stepStates: costruisciStepStates("uploaded"),
      aiDisponibile: false,
      fileUtili: [],
      avvisi: []
    },
    records: []
  };
}

function costruisciStepStates(statoCorrente) {
  const steps = [
    { key: "uploaded", label: "Upload completato" },
    { key: "extracting", label: "Estrazione archivio" },
    { key: "parsing", label: "Lettura file LinkedIn" },
    { key: "contacts", label: "Analisi contatti" },
    { key: "conversations", label: "Analisi conversazioni" },
    { key: "analyzing", label: "Classificazione AI" },
    { key: "dedupe", label: "Deduplica" },
    { key: "preview_ready", label: "Anteprima pronta" },
    { key: "completed", label: "Importazione completata" }
  ];
  const progressivi = {
    uploaded: ["uploaded"],
    extracting: ["uploaded", "extracting"],
    parsing: ["uploaded", "extracting", "parsing"],
    analyzing: ["uploaded", "extracting", "parsing", "contacts", "conversations", "analyzing"],
    preview_ready: ["uploaded", "extracting", "parsing", "contacts", "conversations", "analyzing", "dedupe", "preview_ready"],
    importing: ["uploaded", "extracting", "parsing", "contacts", "conversations", "analyzing", "dedupe", "preview_ready"],
    completed: ["uploaded", "extracting", "parsing", "contacts", "conversations", "analyzing", "dedupe", "preview_ready", "completed"],
    failed: ["uploaded", "extracting", "parsing"],
    cancelled: ["uploaded"]
  };
  const attivo = {
    uploaded: "uploaded",
    extracting: "extracting",
    parsing: "parsing",
    analyzing: "analyzing",
    preview_ready: "preview_ready",
    importing: "preview_ready",
    completed: "completed",
    failed: "parsing",
    cancelled: "uploaded"
  };
  const completati = new Set(progressivi[statoCorrente] || []);
  const attivoKey = attivo[statoCorrente] || statoCorrente;

  return steps.map((step) => ({
    ...step,
    status: step.key === attivoKey ? "active" : completati.has(step.key) ? "done" : "pending"
  }));
}

function aggiornaStatoJob(job, stato, extra = {}) {
  job.status = stato;
  job.metadata = {
    ...(job.metadata || {}),
    ...(extra.metadata || {}),
    stepStates: costruisciStepStates(stato)
  };
  Object.assign(job, extra);
  if (stato === "completed" || stato === "failed" || stato === "cancelled") {
    job.completedAt = new Date().toISOString();
  }
  return job;
}

function parseMultipartZip(req, limite = LIMITE_DIMENSIONE_ZIP) {
  const contentType = req.headers["content-type"] || "";
  const match = contentType.match(/boundary=(.+)$/);
  if (!match) {
    throw new Error("UPLOAD_MULTIPART_INVALID");
  }
  const boundary = match[1];
  const boundaryBuffer = Buffer.from(`--${boundary}`);
  const headerSeparator = Buffer.from("\r\n\r\n");

  return new Promise((resolve, reject) => {
    const chunks = [];
    let totale = 0;
    req.on("data", (chunk) => {
      totale += chunk.length;
      if (totale > limite) {
        reject(new Error("ZIP_TOO_LARGE"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        let searchFrom = 0;

        while (searchFrom < buffer.length) {
          const boundaryIndex = buffer.indexOf(boundaryBuffer, searchFrom);
          if (boundaryIndex === -1) break;

          let partStart = boundaryIndex + boundaryBuffer.length;
          const maybeClose = buffer.subarray(partStart, partStart + 2).toString("utf8");
          if (maybeClose === "--") {
            break;
          }
          if (buffer.subarray(partStart, partStart + 2).toString("utf8") === "\r\n") {
            partStart += 2;
          }

          const headerEnd = buffer.indexOf(headerSeparator, partStart);
          if (headerEnd === -1) break;
          const headerRaw = buffer.subarray(partStart, headerEnd).toString("utf8");
          const dataStart = headerEnd + headerSeparator.length;
          const nextBoundaryIndex = buffer.indexOf(boundaryBuffer, dataStart);
          if (nextBoundaryIndex === -1) break;
          const dataEnd = nextBoundaryIndex - 2;
          const fileBuffer = buffer.subarray(dataStart, dataEnd);
          const headerNome = /name="([^"]+)"/.exec(headerRaw)?.[1];
          const nomeFile = /filename="([^"]+)"/.exec(headerRaw)?.[1];

          if (headerNome === "file" && nomeFile) {
            resolve({
              nomeFile,
              buffer: Buffer.from(fileBuffer)
            });
            return;
          }

          searchFrom = nextBoundaryIndex + boundaryBuffer.length;
        }

        reject(new Error("UPLOAD_FILE_MISSING"));
      } catch (errore) {
        reject(errore);
      }
    });
    req.on("error", reject);
  });
}

function isPercorsoZipSicuro(entryName) {
  if (!entryName || typeof entryName !== "string") return false;
  const normalizzato = entryName.replace(/\\/g, "/");
  if (normalizzato.startsWith("/") || /^[A-Za-z]:/.test(normalizzato)) {
    return false;
  }
  const segmenti = normalizzato.split("/");
  return !segmenti.includes("..");
}

function trovaFirmaDaFondo(buffer, signature) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) {
      return offset;
    }
  }
  return -1;
}

function parseZipEntries(bufferZip) {
  const eocdOffset = trovaFirmaDaFondo(bufferZip, 0x06054b50);
  if (eocdOffset === -1) {
    throw new Error("ZIP_INVALID");
  }

  const totaleEntry = bufferZip.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = bufferZip.readUInt32LE(eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < totaleEntry; index += 1) {
    if (bufferZip.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP_INVALID");
    }

    const generalPurposeBitFlag = bufferZip.readUInt16LE(offset + 8);
    const compressionMethod = bufferZip.readUInt16LE(offset + 10);
    const compressedSize = bufferZip.readUInt32LE(offset + 20);
    const uncompressedSize = bufferZip.readUInt32LE(offset + 24);
    const fileNameLength = bufferZip.readUInt16LE(offset + 28);
    const extraFieldLength = bufferZip.readUInt16LE(offset + 30);
    const fileCommentLength = bufferZip.readUInt16LE(offset + 32);
    const localHeaderOffset = bufferZip.readUInt32LE(offset + 42);
    const nameBuffer = bufferZip.subarray(offset + 46, offset + 46 + fileNameLength);
    const nome = nameBuffer.toString("utf8");

    entries.push({
      nome,
      dimensione: uncompressedSize,
      compressedSize,
      compressionMethod,
      generalPurposeBitFlag,
      localHeaderOffset
    });

    offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
  }

  return entries;
}

function estraiBufferEntryZip(bufferZip, entry) {
  if (entry.generalPurposeBitFlag & 0x1) {
    throw new Error("ZIP_ENCRYPTED_UNSUPPORTED");
  }

  const offset = entry.localHeaderOffset;
  if (bufferZip.readUInt32LE(offset) !== 0x04034b50) {
    throw new Error("ZIP_INVALID");
  }

  const fileNameLength = bufferZip.readUInt16LE(offset + 26);
  const extraFieldLength = bufferZip.readUInt16LE(offset + 28);
  const dataStart = offset + 30 + fileNameLength + extraFieldLength;
  const dataEnd = dataStart + entry.compressedSize;
  const contenutoCompresso = bufferZip.subarray(dataStart, dataEnd);

  if (entry.compressionMethod === 0) {
    return contenutoCompresso;
  }
  if (entry.compressionMethod === 8) {
    return zlib.inflateRawSync(contenutoCompresso);
  }
  throw new Error("ZIP_COMPRESSION_UNSUPPORTED");
}

function ottieniElencoZip(bufferZip) {
  return parseZipEntries(bufferZip).map((entry) => ({
    nome: entry.nome,
    dimensione: entry.dimensione
  }));
}

function estraiZipSicuro(bufferZip) {
  const entries = parseZipEntries(bufferZip);
  if (!entries.length) {
    throw new Error("ZIP_EMPTY");
  }
  const nonSicuri = entries.filter((entry) => !isPercorsoZipSicuro(entry.nome));
  if (nonSicuri.length) {
    throw new Error("ZIP_PATH_TRAVERSAL");
  }
  return entries.map((entry) => ({
    ...entry,
    contenuto: estraiBufferEntryZip(bufferZip, entry)
  }));
}

function parseCsvRobusto(testo) {
  const righe = [];
  let corrente = [];
  let valore = "";
  let inQuotes = false;

  for (let i = 0; i < testo.length; i += 1) {
    const char = testo[i];
    const next = testo[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        valore += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      corrente.push(valore);
      valore = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") {
        i += 1;
      }
      corrente.push(valore);
      righe.push(corrente);
      corrente = [];
      valore = "";
      continue;
    }
    valore += char;
  }

  if (valore || corrente.length) {
    corrente.push(valore);
    righe.push(corrente);
  }

  return righe.filter((riga) => riga.some((valoreCella) => String(valoreCella || "").trim()));
}

function normalizzaHeaderCsv(header) {
  return String(header || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function csvToRecords(testo) {
  const righe = parseCsvRobusto(testo);
  if (righe.length < 2) {
    return [];
  }

  const indiceHeader = righe.findIndex((riga) => {
    const headers = riga.map(normalizzaHeaderCsv).filter(Boolean);
    if (headers.length < 2) return false;
    const joined = headers.join("|");
    return (
      joined.includes("first_name") ||
      joined.includes("email_address") ||
      joined.includes("conversation_id") ||
      joined.includes("sender_profile_url") ||
      joined.includes("content") ||
      joined.includes("date")
    );
  });

  if (indiceHeader === -1 || indiceHeader === righe.length - 1) {
    return [];
  }

  const intestazioni = righe[indiceHeader].map(normalizzaHeaderCsv);
  return righe.slice(indiceHeader + 1).map((riga) =>
    intestazioni.reduce((acc, intestazione, index) => {
      acc[intestazione] = (riga[index] || "").trim();
      return acc;
    }, {})
  ).filter((record) => Object.values(record).some((valore) => String(valore || "").trim()));
}

function riconosciTipoFile(filePath, contenuto) {
  const nome = path.basename(filePath).toLowerCase();
  const ext = path.extname(filePath).toLowerCase();
  const fileDaIgnorare = [
    "profile.csv",
    "profile summary.csv",
    "email addresses.csv",
    "phonenumbers.csv",
    "phone numbers.csv",
    "learningcoachmessages.csv",
    "learning_coach_messages.csv",
    "learning_role_play_messages.csv"
  ];

  if (fileDaIgnorare.includes(nome)) {
    return "ignora";
  }

  if (ext === ".csv") {
    const header = normalizzaHeaderCsv((contenuto.split(/\r?\n/)[0] || "").replace(/,/g, " "));
    if (nome === "connections.csv" || nome === "importedcontacts.csv" || nome.includes("connection") || nome.includes("contact")) {
      return "contatti";
    }
    if (nome === "messages.csv" || nome.includes("message") || nome.includes("conversation") || nome.includes("inmail") || header.includes("sender")) {
      return "messaggi";
    }
  }
  if (ext === ".json") {
    if (nome.includes("message") || nome.includes("conversation") || nome.includes("inmail")) return "messaggi";
    if (nome.includes("connection") || nome.includes("contact") || nome.includes("profile")) return "contatti";
  }
  if (ext === ".txt") {
    if (nome.includes("message") || nome.includes("conversation")) return "messaggi";
  }
  return "ignora";
}

function normalizzaContattoLinkedin(record, sourceFile) {
  const firstName = record.first_name || record.firstname || record.firstName || "";
  const lastName = record.last_name || record.lastname || record.lastName || "";
  const fullName = record.full_name || record.name || `${firstName} ${lastName}`.trim();
  const sourceNormalized = String(sourceFile || "").toLowerCase();
  const sourceKind =
    sourceNormalized === "connections.csv"
      ? "connections"
      : sourceNormalized === "importedcontacts.csv"
        ? "imported_contacts"
        : "other_contacts";
  return {
    fullName: fullName || "Contatto LinkedIn",
    firstName,
    lastName,
    email: record.email_address || record.email || "",
    phone: record.phone_number || record.phone || "",
    linkedinProfileUrl: record.profile_url || record.linkedin_profile_url || record.url || "",
    company: record.company || record.company_name || record.current_company || "",
    jobTitle: record.position || record.job_title || record.title || "",
    location: record.location || record.localita || "",
    industry: record.industry || record.settore || "",
    connectedAt: record.connected_on || record.connected_at || record.date || "",
    importedAt: record.createdat || record.created_at || "",
    sourceKind,
    sourceFile,
    rawData: record
  };
}

function contattoNormalizzatoValido(contatto) {
  const nome = String(contatto.fullName || "").trim();
  const email = String(contatto.email || "").trim();
  const phone = String(contatto.phone || "").trim();
  const linkedin = String(contatto.linkedinProfileUrl || "").trim();
  const company = String(contatto.company || "").trim();
  const ruolo = String(contatto.jobTitle || "").trim();
  if (nome && nome !== "Contatto LinkedIn") {
    return true;
  }
  return Boolean(email || phone || linkedin || company || ruolo);
}

function punteggioQualitaContatto(contatto) {
  let score = 0;
  if (String(contatto.fullName || "").trim() && String(contatto.fullName || "").trim() !== "Contatto LinkedIn") score += 2;
  if (String(contatto.company || "").trim()) score += 2;
  if (String(contatto.jobTitle || "").trim()) score += 2;
  if (String(contatto.email || "").trim()) score += 2;
  if (String(contatto.phone || "").trim()) score += 1;
  if (String(contatto.linkedinProfileUrl || "").trim()) score += 2;
  return score;
}

function strategiaImportContatto(contattoNormalizzato, conversazioniContatto) {
  const qualita = punteggioQualitaContatto(contattoNormalizzato);
  const haConversazioni = conversazioniContatto.some((conversazione) => conversazione.messageCount > 0);

  if (contattoNormalizzato.sourceKind === "connections") {
    return {
      qualita,
      autoExclude: false,
      needsReview: false,
      motivo: "Connessione LinkedIn diretta."
    };
  }

  if (contattoNormalizzato.sourceKind === "imported_contacts") {
    if (!haConversazioni && qualita <= 3) {
      return {
        qualita,
        autoExclude: true,
        needsReview: false,
        motivo: "Contatto importato debole: pochi campi utili e nessuna conversazione."
      };
    }
    return {
      qualita,
      autoExclude: false,
      needsReview: true,
      motivo: "Contatto importato: serve una revisione prima di inserirlo nel CRM."
    };
  }

  return {
    qualita,
    autoExclude: false,
    needsReview: qualita <= 4,
    motivo: qualita <= 4 ? "Contatto con dati parziali: meglio revisionarlo." : "Contatto utilizzabile."
  };
}

function normalizzaMessaggioLinkedin(record, sourceFile) {
  return {
    senderName: record.sender_name || record.from || record.sender || "",
    recipientName: record.recipient_name || record.to || "",
    sentAt: record.date || record.sent_at || record.timestamp || "",
    body: record.content || record.body || record.message || record.text || "",
    attachmentsMetadata: record.attachments || [],
    sourceFile,
    rawData: record
  };
}

function normalizzaConversazioniDaMessaggi(messaggi) {
  const gruppi = new Map();
  for (const messaggio of messaggi) {
    const partecipanti = [messaggio.senderName, messaggio.recipientName].filter(Boolean).sort();
    const chiave = partecipanti.join("|") || `conversazione-${randomUUID()}`;
    const corrente = gruppi.get(chiave) || {
      participantNames: partecipanti,
      participantProfileUrls: [],
      messages: [],
      firstMessageAt: "",
      lastMessageAt: "",
      messageCount: 0,
      sourceFile: messaggio.sourceFile,
      rawData: []
    };
    corrente.messages.push(messaggio);
    corrente.rawData.push(messaggio.rawData);
    corrente.messageCount += 1;
    if (!corrente.firstMessageAt || (messaggio.sentAt && messaggio.sentAt < corrente.firstMessageAt)) {
      corrente.firstMessageAt = messaggio.sentAt;
    }
    if (!corrente.lastMessageAt || (messaggio.sentAt && messaggio.sentAt > corrente.lastMessageAt)) {
      corrente.lastMessageAt = messaggio.sentAt;
    }
    gruppi.set(chiave, corrente);
  }
  return Array.from(gruppi.values());
}

function parseJsonContenuto(testo) {
  try {
    return JSON.parse(testo);
  } catch (_errore) {
    return null;
  }
}

function estraiOggettiRicorsivi(valore) {
  if (Array.isArray(valore)) {
    return valore.flatMap(estraiOggettiRicorsivi);
  }
  if (!valore || typeof valore !== "object") {
    return [];
  }
  const chiavi = Object.keys(valore);
  const sembraRecord = chiavi.some((chiave) =>
    ["name", "fullName", "firstName", "company", "sender", "message", "content", "date", "profile_url"].includes(chiave)
  );
  const discendenti = Object.values(valore).flatMap(estraiOggettiRicorsivi);
  return sembraRecord ? [valore, ...discendenti] : discendenti;
}

function scansionaArchivioLinkedin(entriesZip) {
  const fileUtili = [];
  const contatti = [];
  const messaggi = [];
  const fileTrovati = entriesZip.map((entry) => entry.nome);

  for (const entry of entriesZip) {
    const filePath = entry.nome;
    const ext = path.extname(filePath).toLowerCase();
    if (!ESTENSIONI_TESTO.has(ext)) {
      continue;
    }
    const contenuto = entry.contenuto.toString("utf8");
    const tipo = riconosciTipoFile(filePath, contenuto);
    if (tipo === "ignora") {
      continue;
    }
    fileUtili.push(filePath);

    if (ext === ".csv") {
      const records = csvToRecords(contenuto);
      if (tipo === "contatti") {
        contatti.push(
          ...records
            .map((record) => normalizzaContattoLinkedin(record, path.basename(filePath)))
            .filter(contattoNormalizzatoValido)
        );
      } else if (tipo === "messaggi") {
        messaggi.push(...records.map((record) => normalizzaMessaggioLinkedin(record, path.basename(filePath))));
      }
      continue;
    }

    if (ext === ".json") {
      const parsed = parseJsonContenuto(contenuto);
      if (!parsed) continue;
      const records = estraiOggettiRicorsivi(parsed);
      if (tipo === "contatti") {
        contatti.push(
          ...records
            .map((record) => normalizzaContattoLinkedin(record, path.basename(filePath)))
            .filter(contattoNormalizzatoValido)
        );
      } else if (tipo === "messaggi") {
        messaggi.push(...records.map((record) => normalizzaMessaggioLinkedin(record, path.basename(filePath))));
      }
      continue;
    }

    if (ext === ".txt" && tipo === "messaggi") {
      messaggi.push(
        normalizzaMessaggioLinkedin(
          {
            sender_name: "",
            recipient_name: "",
            date: "",
            content: contenuto.slice(0, 4000)
          },
          path.basename(filePath)
        )
      );
    }
  }

  return {
    fileTrovati,
    fileUtili,
    contatti,
    messaggi,
    conversazioni: normalizzaConversazioniDaMessaggi(messaggi)
  };
}

function chiaveDeduplicaContatto(record) {
  const normalizedName = String(record.fullName || record.nome || "").trim().toLowerCase();
  const normalizedCompany = String(record.company || record.azienda || "").trim().toLowerCase();
  const normalizedRole = String(record.jobTitle || record.ruolo || "").trim().toLowerCase();
  const email = String(record.email || "").trim().toLowerCase();
  const linkedin = String(record.linkedinProfileUrl || "").trim().toLowerCase();
  return {
    email,
    linkedin,
    nomeAzienda: normalizedName && normalizedCompany ? `${normalizedName}|${normalizedCompany}` : "",
    nomeRuolo: normalizedName && normalizedRole ? `${normalizedName}|${normalizedRole}` : ""
  };
}

function trovaMatchContatto(contattoNormalizzato, contattiEsistenti) {
  const chiave = chiaveDeduplicaContatto(contattoNormalizzato);
  return (
    contattiEsistenti.find((contatto) => String(contatto.email || "").toLowerCase() === chiave.email && chiave.email) ||
    contattiEsistenti.find((contatto) => String(contatto.linkedinProfileUrl || "").toLowerCase() === chiave.linkedin && chiave.linkedin) ||
    contattiEsistenti.find((contatto) => {
      const corrente = chiaveDeduplicaContatto(contatto);
      return chiave.nomeAzienda && corrente.nomeAzienda === chiave.nomeAzienda;
    }) ||
    contattiEsistenti.find((contatto) => {
      const corrente = chiaveDeduplicaContatto(contatto);
      return chiave.nomeRuolo && corrente.nomeRuolo === chiave.nomeRuolo;
    }) ||
    null
  );
}

function costruisciPromptSistemaAi() {
  return [
    "Analizza i dati LinkedIn forniti per classificare un contatto in un CRM commerciale.",
    "Usa solo le informazioni presenti nei dati. Non inventare dettagli.",
    "Se non sei sicuro, imposta confidence bassa e suggerisci revisione manuale.",
    "Restituisci solo JSON valido con queste chiavi:",
    "contact_summary, relationship_type, commercial_intent, recommended_pipeline, recommended_stage, priority, tags, next_action, notes, confidence."
  ].join(" ");
}

function costruisciPromptUtenteAi(payload) {
  return JSON.stringify(payload);
}

function troncaMessaggiPerAi(conversazioni) {
  return conversazioni.slice(0, 2).map((conversazione) => ({
    participantNames: conversazione.participantNames,
    firstMessageAt: conversazione.firstMessageAt,
    lastMessageAt: conversazione.lastMessageAt,
    messageCount: conversazione.messageCount,
    estrattoMessaggi: conversazione.messages.slice(-4).map((messaggio) => ({
      senderName: messaggio.senderName,
      sentAt: messaggio.sentAt,
      body: String(messaggio.body || "").slice(0, 500)
    }))
  }));
}

function creaAnalisiBase(contattoNormalizzato, conversazioniContatto) {
  const contattoCrm = arricchisciContatto({
    nome: contattoNormalizzato.fullName,
    ruolo: contattoNormalizzato.jobTitle,
    azienda: contattoNormalizzato.company,
    localita: contattoNormalizzato.location,
    settore: contattoNormalizzato.industry,
    email: contattoNormalizzato.email,
    linkedinProfileUrl: contattoNormalizzato.linkedinProfileUrl,
    ultimoContatto: conversazioniContatto[0]?.lastMessageAt || contattoNormalizzato.connectedAt || "",
    timeline: conversazioniContatto.slice(0, 1).flatMap((conversazione) =>
      conversazione.messages.slice(-2).map((messaggio) => ({
        tipo: "linkedin",
        data: messaggio.sentAt || today(),
        testo: String(messaggio.body || "").slice(0, 240)
      }))
    )
  });

  const haConversazioni = conversazioniContatto.some((conversazione) => conversazione.messageCount > 0);
  const ruolo = String(contattoNormalizzato.jobTitle || "").toLowerCase();
  let relationshipType = "networking";
  if (ruolo.includes("founder") || ruolo.includes("ceo") || ruolo.includes("head")) {
    relationshipType = "lead";
  } else if (ruolo.includes("partner") || ruolo.includes("agency") || ruolo.includes("consul")) {
    relationshipType = "partner";
  }

  let recommendedStage = contattoCrm.stato;
  if (!haConversazioni) {
    recommendedStage = "Da contattare";
  }
  if (contattoNormalizzato.sourceKind === "imported_contacts" && !haConversazioni) {
    recommendedStage = "Non in target";
  }
  if (haConversazioni && ["Follow-up call effettuata", "Follow-up post call"].includes(contattoCrm.stato)) {
    recommendedStage = contattoCrm.stato;
  }

  return {
    contact_summary: `${contattoCrm.nome} in ${contattoCrm.azienda || "azienda non indicata"} con ruolo ${contattoCrm.ruolo}.`,
    relationship_type: relationshipType,
    commercial_intent: haConversazioni ? "medio" : "basso",
    recommended_pipeline: relationshipType === "partner" ? "Pipeline partnership" : "Pipeline commerciale",
    recommended_stage: recommendedStage,
    priority: calcolaPriorita(contattoCrm).toLowerCase(),
    tags: [...new Set([contattoCrm.tipologiaContatto, contattoCrm.settore].filter(Boolean))],
    next_action: haConversazioni ? "Preparare follow-up mirato" : "Inviare primo messaggio",
    notes:
      contattoNormalizzato.sourceKind === "imported_contacts"
        ? "Contatto proveniente da ImportedContacts.csv: valuta se e davvero utile al CRM prima di inserirlo in pipeline."
        : haConversazioni
          ? "Esiste gia una traccia conversazionale da rileggere."
          : "Nessuna conversazione utile trovata nell'archivio.",
    confidence: contattoNormalizzato.sourceKind === "imported_contacts" ? 0.38 : haConversazioni ? 0.62 : 0.45
  };
}

async function analizzaContattoConAi({ contattoNormalizzato, conversazioniContatto, impostazioniAi }) {
  const base = creaAnalisiBase(contattoNormalizzato, conversazioniContatto);
  if (!impostazioniAi?.apiKeyEncrypted || Number(impostazioniAi.creditiResidui || 0) <= 0) {
    return { analisi: base, origine: "regole", errore: "" };
  }

  const payloadAi = {
    contatto: {
      nome: contattoNormalizzato.fullName,
      ruolo: contattoNormalizzato.jobTitle,
      azienda: contattoNormalizzato.company,
      settore: contattoNormalizzato.industry,
      localita: contattoNormalizzato.location,
      collegatoIl: contattoNormalizzato.connectedAt
    },
    conversazioni: troncaMessaggiPerAi(conversazioniContatto)
  };

  try {
    impostazioniAi.creditiResidui = Math.max(0, Number(impostazioniAi.creditiResidui || 0) - 1);
    impostazioniAi.creditiConsumati = Number(impostazioniAi.creditiConsumati || 0) + 1;
    const risposta = await chiamaProviderAi(impostazioniAi, costruisciPromptSistemaAi(), costruisciPromptUtenteAi(payloadAi));
    const parsed = tentaParseJsonAi(JSON.stringify(risposta));
    if (!parsed) {
      throw new Error("AI_PARSE_ERROR");
    }
    return {
      analisi: {
        ...base,
        ...parsed
      },
      origine: "ai",
      errore: ""
    };
  } catch (errore) {
    return {
      analisi: {
        ...base,
        notes: `${base.notes} AI fallback: ${errore.message}.`
      },
      origine: "fallback",
      errore: errore.message
    };
  }
}

function mappaStageSuggerito(stage) {
  if (STATI_PIPELINE.includes(stage)) {
    return stage;
  }
  const lookup = String(stage || "").toLowerCase();
  if (lookup.includes("follow")) return "Follow-up post call";
  if (lookup.includes("call")) return "Follow-up call effettuata";
  if (lookup.includes("contact")) return "Contattato";
  if (lookup.includes("abon")) return "Abbonato";
  if (lookup.includes("ko")) return "KO";
  return "Da contattare";
}

function etichettaSorgenteContatto(sourceKind) {
  if (sourceKind === "connections") return "Connessioni LinkedIn";
  if (sourceKind === "imported_contacts") return "Contatti importati";
  return "Altri contatti";
}

function costruisciPreviewRecord({ contattoNormalizzato, conversazioniContatto, analisi, erroreAi, matchEsistente }) {
  const tipologia = classificaTipologiaContatto({
    ruolo: contattoNormalizzato.jobTitle,
    azienda: contattoNormalizzato.company,
    settore: contattoNormalizzato.industry,
    tag: analisi.tags || []
  });
  const stageSuggerito = mappaStageSuggerito(analisi.recommended_stage);
  const strategia = strategiaImportContatto(contattoNormalizzato, conversazioniContatto);
  const record = {
    id: randomUUID(),
    type: "contact",
    status: matchEsistente ? "duplicate" : analisi.confidence < 0.5 ? "needs_review" : "ready",
    exclude: strategia.autoExclude,
    sourceFile: contattoNormalizzato.sourceFile,
    sourceKind: contattoNormalizzato.sourceKind || "other_contacts",
    sourceLabel: etichettaSorgenteContatto(contattoNormalizzato.sourceKind || "other_contacts"),
    qualityScore: strategia.qualita,
    rawData: {
      contatto: contattoNormalizzato,
      conversazioni: conversazioniContatto.map((conversazione) => ({
        participantNames: conversazione.participantNames,
        lastMessageAt: conversazione.lastMessageAt,
        messageCount: conversazione.messageCount
      }))
    },
    normalizedData: contattoNormalizzato,
    aiAnalysis: analisi,
    suggestedPipeline: analisi.recommended_pipeline || (tipologia === "Potenziale Partner" ? "Pipeline partnership" : "Pipeline commerciale"),
    suggestedStage: stageSuggerito,
    matchedContactId: matchEsistente?.id || "",
    errorMessage: erroreAi || "",
    tagSuggeriti: Array.isArray(analisi.tags) ? analisi.tags : [],
    priorita: (analisi.priority || calcolaPriorita(arricchisciContatto({
      nome: contattoNormalizzato.fullName,
      ruolo: contattoNormalizzato.jobTitle,
      azienda: contattoNormalizzato.company,
      stato: stageSuggerito
    }))).replace(/^./, (char) => char.toUpperCase()),
    tipologiaContatto: tipologia,
    note: analisi.notes || "",
    confidenceScore: Number(analisi.confidence || 0),
    ultimaConversazione: conversazioniContatto[0]?.lastMessageAt || "",
    motivazione: [analisi.contact_summary || "", strategia.motivo].filter(Boolean).join(" ")
  };

  if (strategia.autoExclude) {
    record.status = "excluded";
  } else if (erroreAi === "AI_PARSE_ERROR" || strategia.needsReview) {
    record.status = "needs_review";
  }
  return record;
}

async function processaArchivioLinkedin({ job, bufferZip, contattiEsistenti, impostazioniAi }) {
  aggiornaStatoJob(job, "extracting");
  const entries = estraiZipSicuro(bufferZip);

  aggiornaStatoJob(job, "parsing");
  const risultati = scansionaArchivioLinkedin(entries);
  job.totalFilesFound = entries.length;
  job.totalContactsFound = risultati.contatti.length;
  job.totalConversationsFound = risultati.conversazioni.length;
  job.metadata.fileUtili = risultati.fileUtili;
  job.metadata.aiDisponibile = Boolean(impostazioniAi?.apiKeyEncrypted);

  if (!risultati.contatti.length && !risultati.conversazioni.length) {
    throw new Error("LINKEDIN_DATA_NOT_FOUND");
  }

  aggiornaStatoJob(job, "analyzing");
  const previewRecords = [];

  for (const contattoNormalizzato of risultati.contatti) {
    const nome = String(contattoNormalizzato.fullName || "").toLowerCase();
    const conversazioniContatto = risultati.conversazioni
      .filter((conversazione) => conversazione.participantNames.some((participant) => String(participant || "").toLowerCase() === nome))
      .sort((a, b) => String(b.lastMessageAt || "").localeCompare(String(a.lastMessageAt || "")));

    const matchEsistente = trovaMatchContatto(contattoNormalizzato, contattiEsistenti);
    const rispostaAi = await analizzaContattoConAi({
      contattoNormalizzato,
      conversazioniContatto,
      impostazioniAi
    });

    const record = costruisciPreviewRecord({
      contattoNormalizzato,
      conversazioniContatto,
      analisi: rispostaAi.analisi,
      erroreAi: rispostaAi.errore,
      matchEsistente
    });
    previewRecords.push(record);
  }

  job.records = previewRecords;
  job.totalRecordsAnalyzed = previewRecords.length;
  job.totalDuplicatesFound = previewRecords.filter((record) => record.status === "duplicate").length;
  job.totalErrors = previewRecords.filter((record) => record.status === "failed").length;
  aggiornaStatoJob(job, "preview_ready", {
    metadata: {
      ...(job.metadata || {}),
      avvisi: job.metadata.aiDisponibile ? [] : ["Classificazione AI non disponibile: configura una API key per arricchire i suggerimenti."]
    }
  });

  return job;
}

function applicaOverrideRecord(record, override = {}) {
  return {
    ...record,
    ...override,
    tagSuggeriti: Array.isArray(override.tagSuggeriti) ? override.tagSuggeriti : record.tagSuggeriti,
    exclude: Boolean(override.exclude)
  };
}

function serializzaRecordAnteprima(record) {
  return {
    id: record.id,
    type: record.type,
    status: record.status,
    exclude: record.exclude,
    sourceFile: record.sourceFile,
    sourceKind: record.sourceKind,
    sourceLabel: record.sourceLabel,
    qualityScore: record.qualityScore,
    normalizedData: record.normalizedData,
    aiAnalysis: record.aiAnalysis,
    suggestedPipeline: record.suggestedPipeline,
    suggestedStage: record.suggestedStage,
    matchedContactId: record.matchedContactId,
    errorMessage: record.errorMessage,
    tagSuggeriti: record.tagSuggeriti,
    priorita: record.priorita,
    tipologiaContatto: record.tipologiaContatto,
    note: record.note,
    confidenceScore: record.confidenceScore,
    ultimaConversazione: record.ultimaConversazione,
    motivazione: record.motivazione
  };
}

function importaRecordsNelCrm({ contattiEsistenti, records }) {
  const aggiornati = [...contattiEsistenti];
  let creati = 0;
  let modificati = 0;

  for (const record of records) {
    if (record.exclude || record.status === "excluded") {
      continue;
    }
    const contattoRaw = {
      nome: record.normalizedData.fullName,
      ruolo: record.normalizedData.jobTitle,
      azienda: record.normalizedData.company,
      localita: record.normalizedData.location,
      settore: record.normalizedData.industry,
      email: record.normalizedData.email,
      telefono: record.normalizedData.phone,
      linkedinProfileUrl: record.normalizedData.linkedinProfileUrl,
      ultimoContatto: record.ultimaConversazione || record.normalizedData.connectedAt || "",
      pipelineNome: record.suggestedPipeline,
      stato: record.suggestedStage,
      tag: record.tagSuggeriti,
      timeline: [
        {
          tipo: "import",
          data: today(),
          testo: "Importato da archivio LinkedIn"
        },
        ...(record.note
          ? [
              {
                tipo: "nota-ai",
                data: today(),
                testo: record.note
              }
            ]
          : [])
      ]
    };

    const existingIndex = record.matchedContactId ? aggiornati.findIndex((contatto) => contatto.id === record.matchedContactId) : -1;
    if (existingIndex >= 0) {
      const merged = arricchisciContatto({
        ...aggiornati[existingIndex],
        ...Object.fromEntries(Object.entries(contattoRaw).filter(([, valore]) => valore !== "" && valore !== null && valore !== undefined)),
        tag: [...new Set([...(aggiornati[existingIndex].tag || []), ...(contattoRaw.tag || [])])],
        timeline: [...(aggiornati[existingIndex].timeline || []), ...contattoRaw.timeline]
      });
      aggiornati[existingIndex] = merged;
      modificati += 1;
      record.status = "imported";
      continue;
    }

    aggiornati.push(arricchisciContatto(contattoRaw));
    creati += 1;
    record.status = "imported";
  }

  return {
    contatti: aggiornati,
    creati,
    modificati
  };
}

module.exports = {
  LIMITE_DIMENSIONE_ZIP,
  STATI_JOB,
  STATI_RECORD,
  validaNomeFileZip,
  validaMagicBytesZip,
  creaJobImportazione,
  costruisciStepStates,
  aggiornaStatoJob,
  parseMultipartZip,
  isPercorsoZipSicuro,
  ottieniElencoZip,
  estraiZipSicuro,
  parseCsvRobusto,
  csvToRecords,
  scansionaArchivioLinkedin,
  chiaveDeduplicaContatto,
  trovaMatchContatto,
  creaAnalisiBase,
  punteggioQualitaContatto,
  strategiaImportContatto,
  analizzaContattoConAi,
  mappaStageSuggerito,
  costruisciPreviewRecord,
  processaArchivioLinkedin,
  applicaOverrideRecord,
  serializzaRecordAnteprima,
  importaRecordsNelCrm
};
