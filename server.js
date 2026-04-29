const http = require("http");
const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { URL } = require("url");

const PORTA = process.env.PORT || 3000;
const cartellaPubblica = path.join(__dirname, "public");
const cartellaDati = path.join(__dirname, "data");
const fileContatti = path.join(cartellaDati, "contatti.json");
const fileOfferte  = path.join(cartellaDati, "offerte.json");

// Su Vercel il filesystem è read-only tranne /tmp
const IS_VERCEL = !!process.env.VERCEL;
function percorsoScrittura(nomeFile) {
  if (!IS_VERCEL) return path.join(cartellaDati, nomeFile);
  const tmp = path.join("/tmp", nomeFile);
  if (!fs.existsSync(tmp)) {
    const src = path.join(cartellaDati, nomeFile);
    if (fs.existsSync(src)) fs.copyFileSync(src, tmp);
  }
  return tmp;
}

const STATI_PIPELINE = [
  "Non in target",
  "Da contattare",
  "Contattato",
  "Follow-up call effettuata",
  "Follow-up post call",
  "KO",
  "Abbonato",
  "Disdettato"
];

const OFFERTE_PREDEFINITE = [
  {
    id: "offerta-aito-sprint",
    nome: "Sprint Revenue Engine",
    descrizione: "Setup completo del motore commerciale LinkedIn con import, scoring, messaggi AI e pipeline operativa.",
    prezzo: "EUR 1.900",
    tipologia: "azienda",
    percentualePartner: "0%"
  },
  {
    id: "offerta-aito-abbonamento",
    nome: "Aito Business Pro",
    descrizione: "Abbonamento mensile con contatti illimitati, AI completa, offerte collegate e vista pipeline condivisa.",
    prezzo: "EUR 149/mese",
    tipologia: "azienda",
    percentualePartner: "0%"
  },
  {
    id: "offerta-partner-outreach",
    nome: "Pacchetto Outreach in Partnership",
    descrizione: "Servizio partner per copywriting, follow-up e gestione outreach LinkedIn per il cliente finale.",
    prezzo: "EUR 1.200",
    tipologia: "partner",
    percentualePartner: "30%"
  },
  {
    id: "offerta-partner-training",
    nome: "Training Sales Partner",
    descrizione: "Sessione partner per founder, team sales e consulenti che vogliono aumentare conversioni da chat a call.",
    prezzo: "EUR 900",
    tipologia: "partner",
    percentualePartner: "25%"
  }
];

const CONTATTI_PREDEFINITI = [
  {
    id: "c1",
    nome: "Marco Rinaldi",
    ruolo: "Head of Sales",
    azienda: "ScaleForge",
    localita: "Milano, IT",
    settore: "SaaS B2B",
    punteggioLead: 92,
    stato: "Follow-up call effettuata",
    ultimoContatto: "2026-04-20",
    tag: ["ICP", "SaaS"],
    intento: "Alta",
    sentiment: "Positivo",
    prossimaAzione: "Inviare proposta commerciale",
    insight: "Ha chiesto pricing e flusso operativo dopo una call positiva.",
    offerteProposteIds: ["offerta-aito-sprint", "offerta-aito-abbonamento"],
    offerteSottoscritteIds: [],
    timeline: [
      { id: "t1", tipo: "outbound", data: "2026-04-12", testo: "Primo messaggio di apertura su LinkedIn." },
      { id: "t2", tipo: "inbound", data: "2026-04-15", testo: "Richiesta di dettagli su conversione chat -> call." },
      { id: "t3", tipo: "call", data: "2026-04-20", testo: "Call effettuata con interesse commerciale concreto." }
    ]
  },
  {
    id: "c2",
    nome: "Giulia Conti",
    ruolo: "Founder",
    azienda: "Opero Studio",
    localita: "Roma, IT",
    settore: "Agenzia",
    punteggioLead: 78,
    stato: "Contattato",
    ultimoContatto: "2026-04-18",
    tag: ["Founder", "Agency"],
    intento: "Media",
    sentiment: "Curioso",
    prossimaAzione: "Inviare caso studio e proposta partnership",
    insight: "Profilo con doppio valore: potenziale cliente e potenziale partner.",
    offerteProposteIds: ["offerta-partner-outreach", "offerta-partner-training", "offerta-aito-abbonamento"],
    offerteSottoscritteIds: [],
    timeline: [
      { id: "t4", tipo: "outbound", data: "2026-04-10", testo: "Messaggio di introduzione del prodotto." },
      { id: "t5", tipo: "inbound", data: "2026-04-14", testo: "Richiesta di capire il fit per founder-led sales." }
    ]
  },
  {
    id: "c3",
    nome: "Luca Bassi",
    ruolo: "Growth Manager",
    azienda: "Northpeak",
    localita: "Torino, IT",
    settore: "Tech",
    punteggioLead: 41,
    stato: "Da contattare",
    ultimoContatto: "2026-03-28",
    tag: ["Growth"],
    intento: "Bassa",
    sentiment: "Neutro",
    prossimaAzione: "Primo contatto",
    insight: "Lead in target lato cliente, ancora freddo.",
    offerteProposteIds: ["offerta-aito-sprint"],
    offerteSottoscritteIds: [],
    timeline: [
      { id: "t6", tipo: "import", data: "2026-03-28", testo: "Importato da export LinkedIn." }
    ]
  }
];

const promptAi = {
  classificazione: {
    titolo: "Classificazione Lead",
    obiettivo: "Assegnare lo stato corretto della pipeline usando gli stati definitivi del CRM.",
    template:
      "Classifica il lead in uno di questi stati: Non in target, Da contattare, Contattato, Follow-up call effettuata, Follow-up post call, KO, Abbonato, Disdettato."
  },
  scoring: {
    titolo: "Lead Scoring",
    obiettivo: "Calcolare punteggio, priorita e suggerire prossima azione.",
    template:
      "Valuta fit commerciale, ruolo, azienda, settore, recency, intento e profondita della conversazione per stimare il valore del lead."
  },
  messaggio: {
    titolo: "Messaggio AI",
    obiettivo: "Generare un messaggio LinkedIn pronto da copiare in base allo stato e al contesto.",
    template:
      "Scrivi un messaggio breve, naturale, orientato alla conversione e coerente con lo stato attuale del contatto."
  }
};

function assicuraArchivioDati() {
  if (!IS_VERCEL) {
    if (!fs.existsSync(cartellaDati)) fs.mkdirSync(cartellaDati, { recursive: true });
    if (!fs.existsSync(fileContatti)) fs.writeFileSync(fileContatti, JSON.stringify(CONTATTI_PREDEFINITI, null, 2));
    if (!fs.existsSync(fileOfferte))  fs.writeFileSync(fileOfferte,  JSON.stringify(OFFERTE_PREDEFINITE,  null, 2));
  }
}

function leggiOfferte() {
  const p = percorsoScrittura("offerte.json");
  if (!fs.existsSync(p)) return OFFERTE_PREDEFINITE;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function salvaOfferte(offerte) {
  fs.writeFileSync(percorsoScrittura("offerte.json"), JSON.stringify(offerte, null, 2));
}

function leggiContatti() {
  assicuraArchivioDati();
  const p = IS_VERCEL ? percorsoScrittura("contatti.json") : fileContatti;
  if (!fs.existsSync(p)) return CONTATTI_PREDEFINITI;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function salvaContatti(contatti) {
  fs.writeFileSync(percorsoScrittura("contatti.json"), JSON.stringify(contatti, null, 2));
}

function classificaTipologiaContatto(contatto) {
  const fonte = `${contatto.ruolo} ${contatto.azienda} ${contatto.settore || ""} ${(contatto.tag || []).join(" ")}`.toLowerCase();
  const segnaliPartner = ["agenzia", "studio", "consulent", "advisor", "coach", "freelance", "partner", "outsourcing", "servizi"];
  const segnaliCliente = ["ceo", "founder", "sales", "marketing", "growth", "head", "manager", "operations", "revenue"];

  const punteggioPartner = segnaliPartner.filter((voce) => fonte.includes(voce)).length;
  const punteggioCliente = segnaliCliente.filter((voce) => fonte.includes(voce)).length;

  return punteggioPartner > punteggioCliente ? "Potenziale Partner" : "Potenziale Cliente";
}

function calcolaPriorita(contatto) {
  if (contatto.punteggioLead >= 85 || ["Follow-up call effettuata", "Follow-up post call", "Abbonato"].includes(contatto.stato)) {
    return "Alta";
  }
  if (contatto.punteggioLead >= 60 || ["Contattato", "Da contattare"].includes(contatto.stato)) {
    return "Media";
  }
  return "Bassa";
}

function determinaStato(contatto) {
  const mappaLegacy = {
    New: "Da contattare",
    Engaged: "Contattato",
    Opportunity: "Follow-up call effettuata",
    Cold: "Non in target"
  };

  if (STATI_PIPELINE.includes(contatto.stato)) return contatto.stato;
  if (mappaLegacy[contatto.stato]) return mappaLegacy[contatto.stato];
  if (!contatto.timeline?.length) return "Da contattare";
  return "Contattato";
}

function stimaOffertePerContatto(contatto) {
  const tipologia = classificaTipologiaContatto(contatto);
  const settore = `${contatto.settore || ""} ${contatto.azienda}`.toLowerCase();

  if (tipologia === "Potenziale Partner") {
    return ["offerta-partner-outreach", "offerta-partner-training"];
  }

  if (settore.includes("saas") || settore.includes("tech")) {
    return ["offerta-aito-sprint", "offerta-aito-abbonamento"];
  }

  return ["offerta-aito-sprint"];
}

function costruisciInsight(contatto) {
  if (contatto.insight) return contatto.insight;
  const tipologia = classificaTipologiaContatto(contatto);
  return `${tipologia} con stato ${contatto.stato.toLowerCase()} e priorita ${calcolaPriorita(contatto).toLowerCase()}.`;
}

function costruisciProssimaAzione(contatto) {
  if (contatto.prossimaAzione) return contatto.prossimaAzione;
  const mappa = {
    "Non in target": "Archiviare",
    "Da contattare": "Primo contatto",
    Contattato: "Follow-up",
    "Follow-up call effettuata": "Inviare proposta",
    "Follow-up post call": "Sollecito post call",
    KO: "Chiudere",
    Abbonato: "Upsell o retention",
    Disdettato: "Tentativo di recupero"
  };
  return mappa[contatto.stato] || "Follow-up";
}

function costruisciMessaggioSuggerito(contatto) {
  if (contatto.messaggioSuggerito) return contatto.messaggioSuggerito;

  const messaggi = {
    "Da contattare": `Ciao ${contatto.nome}, ho visto il tuo profilo e penso che Aito Business possa aiutare ${contatto.azienda} a convertire piu conversazioni LinkedIn in call qualificate. Ti va un confronto rapido?`,
    "Contattato": `Ciao ${contatto.nome}, torno sul mio messaggio precedente: se vuoi ti mando un esempio concreto di flusso commerciale applicato a ${contatto.azienda}.`,
    "Follow-up call effettuata": `Ciao ${contatto.nome}, grazie ancora per la call. Ti invio volentieri la proposta con i prossimi step operativi per ${contatto.azienda}.`,
    "Follow-up post call": `Ciao ${contatto.nome}, riprendo il confronto della call per capire come preferisci procedere. Posso mandarti un recap finale con offerta e tempistiche.`,
    "Abbonato": `Ciao ${contatto.nome}, sto preparando alcune opportunita per aumentare ancora il valore generato da Aito Business per ${contatto.azienda}.`,
    "Disdettato": `Ciao ${contatto.nome}, volevo capire se ha senso riaprire il confronto ora che abbiamo introdotto nuove funzionalita nel prodotto.`,
    "KO": `Ciao ${contatto.nome}, grazie comunque del confronto. Se in futuro il tema tornera prioritario, resto disponibile.`,
    "Non in target": `Ciao ${contatto.nome}, grazie del collegamento. Al momento non vedo un fit diretto, ma restiamo in contatto.`,
    default: `Ciao ${contatto.nome}, possiamo fissare un rapido confronto per capire se Aito Business puo aiutare ${contatto.azienda}?`
  };

  return messaggi[contatto.stato] || messaggi.default;
}

function arricchisciContatto(contattoGrezzo) {
  const contatto = {
    ...contattoGrezzo,
    id: contattoGrezzo.id || randomUUID(),
    nome: contattoGrezzo.nome || contattoGrezzo.name || "Contatto senza nome",
    ruolo: contattoGrezzo.ruolo || contattoGrezzo.role || "Ruolo non disponibile",
    azienda: contattoGrezzo.azienda || contattoGrezzo.company || "Azienda non disponibile",
    localita: contattoGrezzo.localita || contattoGrezzo.location || "Localita non disponibile",
    settore: contattoGrezzo.settore || contattoGrezzo.industry || "",
    punteggioLead: Number.isFinite(Number(contattoGrezzo.punteggioLead || contattoGrezzo.leadScore))
      ? Number(contattoGrezzo.punteggioLead || contattoGrezzo.leadScore)
      : 50,
    stato: determinaStato(contattoGrezzo),
    ultimoContatto: contattoGrezzo.ultimoContatto || contattoGrezzo.lastContact || "",
    tag: Array.isArray(contattoGrezzo.tag)
      ? contattoGrezzo.tag
      : typeof contattoGrezzo.tag === "string"
        ? contattoGrezzo.tag.split(",").map((valore) => valore.trim()).filter(Boolean)
        : Array.isArray(contattoGrezzo.tags)
          ? contattoGrezzo.tags
          : [],
    intento: contattoGrezzo.intento || contattoGrezzo.intent || "Media",
    sentiment: contattoGrezzo.sentiment || "Neutro",
    timeline: Array.isArray(contattoGrezzo.timeline)
      ? contattoGrezzo.timeline.map((evento) => ({
          id: evento.id || randomUUID(),
          tipo: evento.tipo || evento.type || "nota",
          data: evento.data || evento.date || today(),
          testo: evento.testo || evento.text || ""
        }))
      : []
  };

  delete contatto.addTimelineEvent;
  contatto.tipologiaContatto = classificaTipologiaContatto(contatto);
  contatto.livelloPriorita = calcolaPriorita(contatto);
  contatto.offerteProposteIds = Array.isArray(contattoGrezzo.offerteProposteIds)
    ? [...new Set(contattoGrezzo.offerteProposteIds)]
    : Array.isArray(contattoGrezzo.recommendedOfferIds)
      ? [...new Set(contattoGrezzo.recommendedOfferIds)]
      : stimaOffertePerContatto(contatto);
  contatto.offerteSottoscritteIds = Array.isArray(contattoGrezzo.offerteSottoscritteIds)
    ? [...new Set(contattoGrezzo.offerteSottoscritteIds)]
    : contatto.stato === "Abbonato"
      ? ["offerta-aito-abbonamento"]
      : [];
  contatto.insight = costruisciInsight(contatto);
  contatto.prossimaAzione = costruisciProssimaAzione(contatto);
  contatto.messaggioSuggerito = costruisciMessaggioSuggerito(contatto);
  return contatto;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function riepilogaContatti(contatti) {
  return contatti.reduce(
    (acc, contatto) => {
      acc.totale += 1;
      acc.perStato[contatto.stato] = (acc.perStato[contatto.stato] || 0) + 1;
      if (contatto.livelloPriorita === "Alta") acc.prioritaAlta += 1;
      return acc;
    },
    {
      totale: 0,
      prioritaAlta: 0,
      perStato: STATI_PIPELINE.reduce((acc, stato) => {
        acc[stato] = 0;
        return acc;
      }, {})
    }
  );
}

function costruisciPipeline(contatti) {
  return STATI_PIPELINE.map((stato) => ({
    stato,
    contatti: contatti.filter((contatto) => contatto.stato === stato)
  }));
}

function trovaOfferta(id) {
  return leggiOfferte().find((offerta) => offerta.id === id);
}

function generaSuggerimentoAi(contatto) {
  const punteggio = Math.max(0, Math.min(100, contatto.punteggioLead + (contatto.intento === "Alta" ? 8 : contatto.intento === "Media" ? 3 : -4)));
  return {
    statoLead: contatto.stato,
    insight: contatto.insight,
    prossimaAzione: contatto.prossimaAzione,
    messaggioSuggerito: costruisciMessaggioSuggerito(contatto),
    punteggio
  };
}

function inviaJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
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
      inviaJson(res, 404, { errore: "File non trovato" });
      return;
    }
    res.writeHead(200, { "Content-Type": mime[ext] || "text/plain; charset=utf-8" });
    res.end(data);
  });
}

function leggiBody(req) {
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
      } catch (errore) {
        reject(errore);
      }
    });
    req.on("error", reject);
  });
}

/* ─────────────── CSV UTILITIES ─────────────── */

function rimuoviBOM(t) { return t.replace(/^﻿/, ""); }

function normalizzaNome(s) {
  return (s || "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function splitLineeCSV(testo) {
  const pulito = rimuoviBOM(testo).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const righe = []; let cur = ""; let inQ = false;
  for (let i = 0; i < pulito.length; i++) {
    const c = pulito[i];
    if (c === '"') { if (inQ && pulito[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === "\n" && !inQ) { righe.push(cur); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) righe.push(cur);
  return righe;
}

function splitCampiCSV(riga) {
  const out = []; let cur = ""; let inQ = false;
  for (let i = 0; i < riga.length; i++) {
    const c = riga[i];
    if (c === '"') { if (inQ && riga[i+1] === '"') { cur += '"'; i++; } else inQ = !inQ; }
    else if (c === "," && !inQ) { out.push(cur.trim().replace(/^"|"$/g, "")); cur = ""; }
    else cur += c;
  }
  out.push(cur.trim().replace(/^"|"$/g, ""));
  return out;
}

function trovaCol(header, ...chiavi) {
  const h = header.map(c => c.toLowerCase().replace(/[\s"'_\-]+/g, ""));
  for (const k of chiavi) {
    const kn = k.toLowerCase().replace(/[\s"'_\-]+/g, "");
    const i = h.findIndex(c => c === kn || c.includes(kn));
    if (i !== -1) return i;
  }
  return -1;
}

function parseDataLinkedIn(str = "") {
  const mesi = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
                  gen:0,mag:4,giu:5,lug:6,ago:7,set:8,ott:9,dic:11 };
  // "23 Apr 2026"
  const m1 = str.match(/(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})/);
  if (m1) {
    const month = mesi[m1[2].toLowerCase().slice(0,3)];
    if (month !== undefined) return new Date(parseInt(m1[3]), month, parseInt(m1[1])).toISOString().slice(0,10);
  }
  // "2026-04-23 09:12:42 UTC" or ISO
  const m2 = str.match(/(\d{4})[-/](\d{2})[-/](\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  // "4/22/26" (US format from Invitations)
  const m3 = str.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m3) {
    const y = parseInt(m3[3]); const yy = y < 100 ? 2000 + y : y;
    return new Date(yy, parseInt(m3[1]) - 1, parseInt(m3[2])).toISOString().slice(0,10);
  }
  return today();
}

/* ─────────────── RILEVAMENTO FORMATO ─────────────── */

function rilevaFormatoCSV(righe) {
  for (let i = 0; i < Math.min(6, righe.length); i++) {
    const campi = splitCampiCSV(righe[i]).map(c => c.toLowerCase().trim().replace(/[\s"]+/g, ""));
    if (campi.some(c => c === "conversationid" || c.includes("conversationid")) &&
        campi.some(c => c.includes("content") || c.includes("date"))) {
      return { tipo: "linkedin-messages", rigaH: i };
    }
    if (campi.some(c => c.includes("firstname") || c === "nome") &&
        campi.some(c => c.includes("lastname") || c === "cognome" || c.includes("company") || c.includes("connected"))) {
      return { tipo: "linkedin-connections", rigaH: i };
    }
  }
  return { tipo: "generico", rigaH: 0 };
}

/* ─────────────── PARSER: PROFILO UTENTE ─────────────── */

function parseLinkedInProfile(testo) {
  const righe = splitLineeCSV(testo).filter(r => r.trim());
  if (righe.length < 2) return null;
  const h = splitCampiCSV(righe[0]);
  const c = splitCampiCSV(righe[1]);
  const g = (idx) => (idx >= 0 && c[idx]) ? c[idx].trim() : "";
  return {
    nome: [g(trovaCol(h, "first name", "firstname")), g(trovaCol(h, "last name", "lastname"))].filter(Boolean).join(" "),
    headline: g(trovaCol(h, "headline", "title")),
    bio: g(trovaCol(h, "summary"))
  };
}

/* ─────────────── PARSER LINKEDIN CONNECTIONS ─────────────── */

function parseLinkedInConnections(testo) {
  const righe = splitLineeCSV(testo).filter(r => r.trim());
  const { rigaH } = rilevaFormatoCSV(righe);
  if (righe.length <= rigaH + 1) return [];
  const h = splitCampiCSV(righe[rigaH]);
  const iNome     = trovaCol(h, "first name", "firstname", "nome", "first");
  const iCognome  = trovaCol(h, "last name", "lastname", "cognome", "last");
  const iEmail    = trovaCol(h, "email address", "email", "mail");
  const iAzienda  = trovaCol(h, "company", "azienda", "employer", "organization");
  const iRuolo    = trovaCol(h, "position", "title", "jobtitle", "ruolo", "job title");
  const iLocalita = trovaCol(h, "location", "localita", "city", "region", "country");
  const iSettore  = trovaCol(h, "industry", "settore", "sector");
  const iConnOn   = trovaCol(h, "connected on", "connectedon", "connected");
  const iUrl      = trovaCol(h, "url", "profileurl", "linkedin url", "link");
  const g = (campi, idx) => (idx >= 0 && campi[idx]) ? campi[idx].trim() : "";
  const out = [];
  for (let i = rigaH + 1; i < righe.length; i++) {
    const c = splitCampiCSV(righe[i]);
    if (c.every(x => !x.trim())) continue;
    const nome = [g(c, iNome), g(c, iCognome)].filter(Boolean).join(" ");
    if (!nome) continue;
    const connON = g(c, iConnOn);
    const url = g(c, iUrl);
    out.push({
      nome, email: g(c, iEmail),
      azienda: g(c, iAzienda) || "Azienda sconosciuta",
      ruolo: g(c, iRuolo) || "Ruolo non disponibile",
      localita: g(c, iLocalita), settore: g(c, iSettore),
      linkedinUrl: url,
      punteggioLead: 50,
      stato: "Da contattare",
      ultimoContatto: parseDataLinkedIn(connON),
      dataConnessione: parseDataLinkedIn(connON),
      tag: ["LinkedIn"],
      timeline: [{ tipo: "import", data: today(),
        testo: `Connesso su LinkedIn${connON ? ` il ${connON}` : ""}.` }]
    });
  }
  return out;
}

/* ─────────────── PARSER LINKEDIN MESSAGES ─────────────── */

function parseLinkedInMessages(testo, nomeUtente = "") {
  const righe = splitLineeCSV(testo).filter(r => r.trim());
  const { rigaH } = rilevaFormatoCSV(righe);
  if (righe.length <= rigaH + 1) return new Map();
  const h = splitCampiCSV(righe[rigaH]);
  const iFrom    = trovaCol(h, "from", "sender", "da", "mittente");
  const iFromUrl = trovaCol(h, "sender profile url", "senderprofileurl");
  const iTo      = trovaCol(h, "to", "recipient", "a", "destinatario");
  const iToUrl   = trovaCol(h, "recipient profile urls", "recipientprofileurls");
  const iDate    = trovaCol(h, "date", "sentat", "timestamp", "data");
  const iContent = trovaCol(h, "content", "messagebody", "body", "message", "testo");
  const g = (c, idx) => (idx >= 0 && c[idx]) ? c[idx].trim() : "";

  const parPos = ["interessato","voglio","quando","fissiamo","volentieri","perfetto","grazie","ottimo",
    "certo","assolutamente","disponibile","procediamo","sounds good","let's","would love","interested",
    "great","perfect","yes","sure","absolutely"];
  const parNeg = ["no grazie","non sono interessato","non mi interessa","spam","stop","remove me",
    "unsubscribe","not interested","no thanks"];

  const nomeUtNorm = normalizzaNome(nomeUtente);

  // Index by URL (most reliable) and by name (fallback)
  const byUrl  = new Map();   // linkedinUrl → stats
  const byNome = new Map();   // normalizedName → stats

  const getOrCreate = (map, key, nome) => {
    if (!map.has(key)) map.set(key, { count:0, ultimaData:"", sentimento:"Neutro", nome });
    return map.get(key);
  };

  for (let i = rigaH + 1; i < righe.length; i++) {
    const c = splitCampiCSV(righe[i]);
    const from    = g(c, iFrom);
    const fromUrl = g(c, iFromUrl);
    const to      = g(c, iTo);
    const toUrl   = g(c, iToUrl).split(",")[0].trim();
    const date    = parseDataLinkedIn(g(c, iDate));
    const content = g(c, iContent).toLowerCase();
    if (!from) continue;

    // Identify "other party" vs the user
    const fromNorm = normalizzaNome(from);
    const fromIsUser = nomeUtNorm && (fromNorm === nomeUtNorm || fromNorm.includes(nomeUtNorm) || nomeUtNorm.includes(fromNorm));
    const otherName = fromIsUser ? to : from;
    const otherUrl  = fromIsUser ? toUrl : fromUrl;

    if (!otherName) continue;

    let s;
    if (otherUrl) {
      s = getOrCreate(byUrl, otherUrl, otherName);
    } else {
      s = getOrCreate(byNome, normalizzaNome(otherName), otherName);
    }

    s.count++;
    if (date > s.ultimaData) s.ultimaData = date;
    if (s.sentimento !== "Positivo") {
      if (parPos.some(p => content.includes(p))) s.sentimento = "Positivo";
      else if (parNeg.some(p => content.includes(p))) s.sentimento = "Negativo";
    }
  }

  // Merge into single map (URL keys first, then name keys)
  const result = new Map();
  for (const [url, s] of byUrl)  result.set(url, { ...s, tipoKey: "url" });
  for (const [nom, s] of byNome) if (!result.has(nom)) result.set(nom, { ...s, tipoKey: "nome" });
  return result;
}

/* ─────────────── PARSER INVITAZIONI ─────────────── */

function parseLinkedInInvitations(testo) {
  const righe = splitLineeCSV(testo).filter(r => r.trim());
  if (righe.length < 2) return new Map();
  const h = splitCampiCSV(righe[0]);
  const iTo    = trovaCol(h, "to", "a");
  const iSent  = trovaCol(h, "sent at", "sentat", "date");
  const iDir   = trovaCol(h, "direction", "tipo");
  const iToUrl = trovaCol(h, "invitee profile url", "inviteeprofileurl");
  const g = (c, idx) => (idx >= 0 && c[idx]) ? c[idx].trim() : "";
  const mappa = new Map();
  for (let i = 1; i < righe.length; i++) {
    const c = splitCampiCSV(righe[i]);
    const dir = g(c, iDir).toUpperCase();
    if (dir !== "OUTGOING") continue;
    const to    = g(c, iTo);
    const toUrl = g(c, iToUrl);
    const data  = parseDataLinkedIn(g(c, iSent));
    if (!to) continue;
    const key = toUrl || normalizzaNome(to);
    if (!mappa.has(key)) mappa.set(key, { data, url: toUrl, nome: to });
  }
  return mappa;
}

/* ─────────────── PARSER CONTATTI IMPORTATI (telefoni) ─────────────── */

function parseImportedContacts(testo) {
  const righe = splitLineeCSV(testo).filter(r => r.trim());
  if (righe.length < 2) return new Map();
  const h = splitCampiCSV(righe[0]);
  const iNome    = trovaCol(h, "firstname", "first name", "nome");
  const iCognome = trovaCol(h, "lastname", "last name", "cognome");
  const iPhone   = trovaCol(h, "phonenumbers", "phone numbers", "phone", "telefono");
  const iEmail   = trovaCol(h, "emails", "email");
  const g = (c, idx) => (idx >= 0 && c[idx]) ? c[idx].trim() : "";
  const mappa = new Map();
  for (let i = 1; i < righe.length; i++) {
    const c = splitCampiCSV(righe[i]);
    const nome = [g(c, iNome), g(c, iCognome)].filter(Boolean).join(" ").trim();
    if (!nome) continue;
    // phones can be "334-328-2880\, 3343282880"
    const phones = g(c, iPhone).split(/[,\\]+/).map(p => p.trim().replace(/[^\d+]/g, "")).filter(p => p.length >= 7);
    const telefono = phones[0] || "";
    const email = g(c, iEmail).split(",")[0].trim();
    if (telefono || email) mappa.set(normalizzaNome(nome), { telefono, email });
  }
  return mappa;
}

/* ─────────────── PARSER GENERICO CSV ─────────────── */

function parseGenericoCSV(testo) {
  const righe = splitLineeCSV(testo).filter(r => r.trim());
  if (righe.length < 2) return [];
  const h = splitCampiCSV(righe[0]);
  const g = (campi, ...chiavi) => {
    for (const k of chiavi) { const i = trovaCol(h, k); if (i >= 0 && campi[i]?.trim()) return campi[i].trim(); }
    return "";
  };
  return righe.slice(1).map(riga => {
    const c = splitCampiCSV(riga);
    if (c.every(x => !x.trim())) return null;
    const nome = [g(c,"first name","firstname","nome","name"), g(c,"last name","lastname","cognome")].filter(Boolean).join(" ");
    if (!nome) return null;
    return {
      nome, azienda: g(c,"company","azienda","employer") || "Azienda sconosciuta",
      ruolo: g(c,"position","title","ruolo","role") || "Ruolo non disponibile",
      localita: g(c,"location","localita","city"), settore: g(c,"industry","settore"),
      punteggioLead: parseInt(g(c,"score","punteggio","lead score")) || 50,
      stato: g(c,"stato","state","status") || "Da contattare",
      tag: ["Import"], timeline: []
    };
  }).filter(Boolean);
}

/* ─────────────── ARRICCHIMENTO CON MESSAGGI ─────────────── */

function arricchisciConMessaggi(contatti, mappaMsg) {
  if (!mappaMsg.size) return contatti;
  return contatti.map(c => {
    // Try URL match first (most reliable)
    let s = (c.linkedinUrl && mappaMsg.has(c.linkedinUrl)) ? mappaMsg.get(c.linkedinUrl) : null;
    // Fallback: normalized name match
    if (!s) {
      const nN = normalizzaNome(c.nome);
      for (const [key, val] of mappaMsg) {
        if (val.tipoKey !== "nome") continue;
        const nM = key; // already normalized
        if (nN === nM || nN.startsWith(nM.split(" ")[0]) || nM.startsWith(nN.split(" ")[0])) {
          s = val; break;
        }
      }
    }
    if (!s) return c;
    const boost = Math.min(40, s.count * 5);
    const statoMsg = s.count >= 10 ? "Follow-up call effettuata"
                   : s.count >= 5  ? "Contattato"
                   : s.count >= 2  ? "Da contattare"
                   :                 "Da contattare";
    return {
      ...c,
      punteggioLead: Math.min(99, (c.punteggioLead || 50) + boost),
      ultimoContatto: s.ultimaData || c.ultimoContatto,
      stato: statoMsg,
      sentiment: s.sentimento,
      messaggiCount: s.count,
      ultimoMessaggio: s.ultimaData,
      tag: [...(c.tag || []).filter(t => !t.includes("msg")), `${s.count} msg`],
      timeline: [...(c.timeline || []), {
        tipo: "inbound", data: s.ultimaData || today(),
        testo: `${s.count} messaggi scambiati · Sentimento: ${s.sentimento}`
      }]
    };
  });
}

/* ─────────────── ARRICCHIMENTO CON INVITAZIONI ─────────────── */

function arricchisciConInvitazioni(contatti, mappaInv) {
  if (!mappaInv.size) return contatti;
  return contatti.map(c => {
    const byUrl  = c.linkedinUrl ? mappaInv.get(c.linkedinUrl) : null;
    const byNome = mappaInv.get(normalizzaNome(c.nome));
    const inv    = byUrl || byNome;
    if (!inv) return c;
    return {
      ...c,
      tag: [...(c.tag || []), "Invitato"],
      timeline: [...(c.timeline || []), {
        tipo: "outbound", data: inv.data || today(),
        testo: `Invito LinkedIn inviato il ${inv.data || today()}`
      }]
    };
  });
}

/* ─────────────── DEDUPLICAZIONE ─────────────── */

function deduplicaLista(lista) {
  const visti = new Map();
  for (const c of lista) {
    // Prefer URL-based dedup (most reliable); fallback to nome+azienda
    const urlKey  = c.linkedinUrl ? c.linkedinUrl.toLowerCase().replace(/\/$/, "") : null;
    const nameKey = `${normalizzaNome(c.nome)}|${normalizzaNome(c.azienda || "")}`;
    const k = urlKey || (nameKey !== "|" ? nameKey : null);
    if (k && !visti.has(k)) visti.set(k, c);
  }
  return Array.from(visti.values());
}

/* ─────────────── IMPORT PRINCIPALE ─────────────── */

// File names handled by filename routing (not content detection)
const FILE_IGNORATI = new Set([
  "searchqueries.csv","reactions.csv","ads clicked.csv","ad_targeting.csv",
  "logins.csv","security challenges.csv","votes.csv","inferences_about_you.csv",
  "lan ads engagement.csv","learning.csv","learningcoach.csv",
  "learning_coach_messages.csv","learning_role_play_messages.csv",
  "receipts_v2.csv","registration.csv","whatsapp phone numbers.csv",
  "savedjob alerts.csv","rich_media.csv","member_follows.csv","company follows.csv",
  "endorsement_received_info.csv","endorsement_given_info.csv",
  "shares.csv","comments.csv","instantreposts.csv","saved_items.csv",
  "profile summary.csv","phonenumbers.csv","email addresses.csv",
  "job seeker preferences.csv","job applicant saved answers.csv",
  "saved jobs.csv","providers.csv","verifications.csv",
  "job applicant saved screening question responses.csv",
  "job applications.csv","job applications_1.csv","job applications_2.csv"
]);

function parsaFilesImport(files) {
  let tutti = [];
  let mappaMsg = new Map();
  let mappaInv = new Map();
  let mappaPhone = new Map();
  let profilo = null;

  // Pass 1: profilo utente (serve per riconoscere i messaggi dell'utente)
  for (const { nome, contenuto } of files) {
    const baseName = nome.toLowerCase().split("/").pop().trim();
    if (baseName === "profile.csv") { profilo = parseLinkedInProfile(contenuto); break; }
  }

  // Pass 2: tutti gli altri file
  for (const { nome, contenuto } of files) {
    const baseName = nome.toLowerCase().split("/").pop().trim();
    if (baseName === "profile.csv") continue;

    if (baseName === "messages_summary.json") {
      // Pre-aggregato dal browser: array di { nome, url, count, ultimaData, sentimento, tipoKey }
      try {
        const arr = JSON.parse(contenuto);
        if (Array.isArray(arr)) {
          for (const s of arr) {
            const key = s.url || normalizzaNome(s.nome || "");
            if (key) mappaMsg.set(key, { ...s, tipoKey: s.tipoKey || (s.url ? "url" : "nome") });
          }
        }
      } catch {}
      continue;
    }

    if (baseName.endsWith(".json")) {
      try { const d = JSON.parse(contenuto); tutti.push(...(Array.isArray(d) ? d : d.contatti || [])); } catch {}
      continue;
    }
    if (FILE_IGNORATI.has(baseName) || baseName.startsWith("job applicant")) continue;

    if (baseName === "connections.csv") {
      tutti.push(...parseLinkedInConnections(contenuto));
    } else if (baseName === "messages.csv") {
      // Fallback: se per qualche ragione arriva il CSV grezzo (upload diretto, non ZIP)
      mappaMsg = parseLinkedInMessages(contenuto, profilo?.nome || "");
    } else if (baseName === "invitations.csv") {
      mappaInv = parseLinkedInInvitations(contenuto);
    } else if (baseName === "importedcontacts.csv") {
      mappaPhone = parseImportedContacts(contenuto);
    } else {
      // Auto-detect for unknown CSVs
      const righe = splitLineeCSV(contenuto).filter(r => r.trim());
      const { tipo } = rilevaFormatoCSV(righe);
      if (tipo === "linkedin-connections") tutti.push(...parseLinkedInConnections(contenuto));
      else if (tipo === "linkedin-messages") {
        const mm = parseLinkedInMessages(contenuto, profilo?.nome || "");
        for (const [k, v] of mm) if (!mappaMsg.has(k)) mappaMsg.set(k, v);
      }
      // Ignora altri file non riconosciuti
    }
  }

  // Arricchimento progressivo
  if (mappaMsg.size)   tutti = arricchisciConMessaggi(tutti, mappaMsg);
  if (mappaInv.size)   tutti = arricchisciConInvitazioni(tutti, mappaInv);

  // Aggiungi telefoni da ImportedContacts
  if (mappaPhone.size) {
    tutti = tutti.map(c => {
      const pd = mappaPhone.get(normalizzaNome(c.nome));
      if (!pd) return c;
      return {
        ...c,
        telefono: c.telefono || pd.telefono || "",
        email:    c.email    || pd.email    || ""
      };
    });
  }

  return deduplicaLista(tutti);
}

const rotteApplicazione = ["/", "/dashboard", "/contatti", "/pipeline", "/offerte", "/analytics", "/onboarding", "/suggerimenti-ai"];
const rotteLegacy = ["/contacts", "/upload", "/offers", "/ai-suggestions", "/segments"];

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  const contatti = leggiContatti().map(arricchisciContatto);

  if (pathname === "/api/metadati" && req.method === "GET") {
    inviaJson(res, 200, { statiPipeline: STATI_PIPELINE, offerte: leggiOfferte() });
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
    const offerte = leggiOfferte().map((offerta) => ({
      ...offerta,
      contattiProposti: contatti.filter((c) => (c.offerteProposteIds || []).includes(offerta.id)).length,
      contattiSottoscritti: contatti.filter((c) => (c.offerteSottoscritteIds || []).includes(offerta.id)).length
    }));
    inviaJson(res, 200, { offerte });
    return;
  }

  if (pathname === "/api/offerte" && req.method === "POST") {
    try {
      const body = await leggiBody(req);
      if (!body.nome) { inviaJson(res, 400, { errore: "Il campo nome è obbligatorio" }); return; }
      const offerte = leggiOfferte();
      const nuova = {
        id: `offerta-${randomUUID().slice(0, 8)}`,
        nome: body.nome,
        descrizione: body.descrizione || "",
        prezzo: body.prezzo || "—",
        tipologia: body.tipologia === "partner" ? "partner" : "azienda",
        percentualePartner: body.percentualePartner || "0%"
      };
      offerte.push(nuova);
      salvaOfferte(offerte);
      inviaJson(res, 201, { offerta: nuova, offerte });
    } catch { inviaJson(res, 400, { errore: "Payload non valido" }); }
    return;
  }

  if (pathname.startsWith("/api/offerte/") && req.method === "PATCH") {
    try {
      const id = pathname.split("/").pop();
      const body = await leggiBody(req);
      const offerte = leggiOfferte();
      const idx = offerte.findIndex((o) => o.id === id);
      if (idx === -1) { inviaJson(res, 404, { errore: "Offerta non trovata" }); return; }
      offerte[idx] = { ...offerte[idx], ...body, id };
      salvaOfferte(offerte);
      inviaJson(res, 200, { offerta: offerte[idx], offerte });
    } catch { inviaJson(res, 400, { errore: "Payload non valido" }); }
    return;
  }

  if (pathname.startsWith("/api/offerte/") && req.method === "DELETE") {
    const id = pathname.split("/").pop();
    const offerte = leggiOfferte();
    const nuove = offerte.filter((o) => o.id !== id);
    if (nuove.length === offerte.length) { inviaJson(res, 404, { errore: "Offerta non trovata" }); return; }
    salvaOfferte(nuove);
    inviaJson(res, 200, { offerte: nuove });
    return;
  }

  if (pathname.startsWith("/api/contatti/") && req.method === "GET") {
    const id = pathname.split("/").pop();
    const contatto = contatti.find((item) => item.id === id);
    if (!contatto) {
      inviaJson(res, 404, { errore: "Contatto non trovato" });
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
      const body = await leggiBody(req);
      const esiste = contatti.find((item) => item.id === id);
      if (!esiste) {
        inviaJson(res, 404, { errore: "Contatto non trovato" });
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

      salvaContatti(prossimiContatti);
      const contattoAggiornato = prossimiContatti.find((contatto) => contatto.id === id);
      inviaJson(res, 200, { contatto: contattoAggiornato, riepilogo: riepilogaContatti(prossimiContatti) });
    } catch (errore) {
      inviaJson(res, 400, { errore: "Payload aggiornamento non valido" });
    }
    return;
  }

  if (pathname === "/api/import/preview" && req.method === "POST") {
    try {
      const body = await leggiBody(req);
      const files = Array.isArray(body.files) ? body.files : [];
      if (!files.length) { inviaJson(res, 400, { errore: "Nessun file fornito" }); return; }
      const contattiRaw = parsaFilesImport(files);
      if (!contattiRaw.length) { inviaJson(res, 400, { errore: "Nessun contatto trovato. Verifica il formato del file." }); return; }
      // Deduplica rispetto ai contatti già presenti (per URL o nome+azienda)
      const chiaviUrl  = new Set(contatti.filter(c => c.linkedinUrl).map(c => c.linkedinUrl.toLowerCase().replace(/\/$/, "")));
      const chiaviNome = new Set(contatti.map(c => `${normalizzaNome(c.nome)}|${normalizzaNome(c.azienda||"")}`));
      const isDup = (c) => (c.linkedinUrl && chiaviUrl.has(c.linkedinUrl.toLowerCase().replace(/\/$/, "")))
                        || chiaviNome.has(`${normalizzaNome(c.nome)}|${normalizzaNome(c.azienda||"")}`);
      const anteprima = contattiRaw.slice(0, 300).map(c => {
        const a = arricchisciContatto(c);
        return { nome: a.nome, ruolo: a.ruolo, azienda: a.azienda, localita: a.localita,
          tipologiaContatto: a.tipologiaContatto, livelloPriorita: a.livelloPriorita,
          punteggioLead: a.punteggioLead, stato: a.stato, tag: a.tag,
          messaggiCount: c.messaggiCount || 0, linkedinUrl: c.linkedinUrl || "",
          isDuplicate: isDup(c) };
      });
      const conMsg    = contattiRaw.filter(c => (c.messaggiCount || 0) > 0).length;
      const conInvito = contattiRaw.filter(c => (c.tag||[]).includes("Invitato")).length;
      const partner   = contattiRaw.filter(c => classificaTipologiaContatto(c) === "Potenziale Partner").length;
      inviaJson(res, 200, {
        anteprima,
        stats: {
          trovati:    contattiRaw.length,
          nuovi:      contattiRaw.filter(c => !isDup(c)).length,
          duplicati:  contattiRaw.filter(c =>  isDup(c)).length,
          conMessaggi: conMsg,
          conInvito,
          partner,
          inAnteprima: anteprima.length
        },
        _payload: contattiRaw
      });
    } catch (e) { inviaJson(res, 400, { errore: `Errore analisi: ${e.message}` }); }
    return;
  }

  if (pathname === "/api/import" && req.method === "POST") {
    try {
      const body = await leggiBody(req);
      const nuoviContatti = Array.isArray(body._payload) ? body._payload
        : Array.isArray(body.contatti) ? body.contatti : [];
      if (!nuoviContatti.length) { inviaJson(res, 400, { errore: "Nessun contatto trovato" }); return; }
      const normalizzati = nuoviContatti.map(arricchisciContatto);
      const mappa = new Map();
      [...contatti, ...normalizzati].forEach((c) => {
        const k = `${c.nome.toLowerCase()}|${c.azienda.toLowerCase()}`;
        mappa.set(k, c);
      });
      const unificati = Array.from(mappa.values());
      salvaContatti(unificati);
      inviaJson(res, 200, {
        importati: normalizzati.length,
        totale: unificati.length,
        contatti: unificati,
        riepilogo: riepilogaContatti(unificati)
      });
    } catch { inviaJson(res, 400, { errore: "Payload import non valido" }); }
    return;
  }

  if (pathname === "/api/reset" && req.method === "POST") {
    salvaContatti(CONTATTI_PREDEFINITI);
    inviaJson(res, 200, {
      contatti: CONTATTI_PREDEFINITI.map(arricchisciContatto),
      riepilogo: riepilogaContatti(CONTATTI_PREDEFINITI.map(arricchisciContatto))
    });
    return;
  }

  if (pathname === "/api/prompt-ai" && req.method === "GET") {
    inviaJson(res, 200, { promptAi });
    return;
  }

  if (pathname === "/api/suggerimenti-ai" && req.method === "GET") {
    const suggerimenti = contatti
      .map((contatto) => ({
        id: contatto.id,
        nome: contatto.nome,
        azienda: contatto.azienda,
        suggerimento: generaSuggerimentoAi(contatto)
      }))
      .sort((a, b) => b.suggerimento.punteggio - a.suggerimento.punteggio);
    inviaJson(res, 200, { suggerimenti });
    return;
  }

  if (pathname === "/api/ai/genera" && req.method === "POST") {
    try {
      const body = await leggiBody(req);
      const contatto = contatti.find((item) => item.id === body.contattoId);
      if (!contatto) {
        inviaJson(res, 404, { errore: "Contatto non trovato" });
        return;
      }
      const suggerimento = generaSuggerimentoAi(contatto);
      const contattiAggiornati = contatti.map((item) =>
        item.id === contatto.id
          ? arricchisciContatto({
              ...item,
              punteggioLead: suggerimento.punteggio,
              prossimaAzione: suggerimento.prossimaAzione,
              messaggioSuggerito: suggerimento.messaggioSuggerito,
              insight: suggerimento.insight
            })
          : item
      );
      salvaContatti(contattiAggiornati);
      inviaJson(res, 200, {
        suggerimento,
        contatto: contattiAggiornati.find((item) => item.id === contatto.id)
      });
    } catch (errore) {
      inviaJson(res, 400, { errore: "Payload AI non valido" });
    }
    return;
  }

  if (rotteLegacy.includes(pathname)) {
    const redirect = {
      "/contacts": "/contatti",
      "/upload": "/onboarding",
      "/offers": "/offerte",
      "/ai-suggestions": "/suggerimenti-ai",
      "/segments": "/pipeline"
    }[pathname];
    res.writeHead(302, { Location: redirect });
    res.end();
    return;
  }

  if (rotteApplicazione.includes(pathname) || /^\/contatti\/[^/]+$/.test(pathname)) {
    inviaFile(res, path.join(cartellaPubblica, "index.html"));
    return;
  }

  if (pathname.startsWith("/public/")) {
    inviaFile(res, path.join(__dirname, pathname));
    return;
  }

  inviaJson(res, 404, { errore: "Rotta non trovata" });
});

if (require.main === module) {
  assicuraArchivioDati();
  server.listen(PORTA, () => {
    console.log(`Aito Business in esecuzione su http://localhost:${PORTA}`);
  });
}

module.exports = server;
