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
  if (!fs.existsSync(cartellaDati)) {
    fs.mkdirSync(cartellaDati, { recursive: true });
  }
  if (!fs.existsSync(fileContatti)) {
    fs.writeFileSync(fileContatti, JSON.stringify(CONTATTI_PREDEFINITI, null, 2));
  }
  if (!fs.existsSync(fileOfferte)) {
    fs.writeFileSync(fileOfferte, JSON.stringify(OFFERTE_PREDEFINITE, null, 2));
  }
}

function leggiOfferte() {
  assicuraArchivioDati();
  return JSON.parse(fs.readFileSync(fileOfferte, "utf8"));
}

function salvaOfferte(offerte) {
  fs.writeFileSync(fileOfferte, JSON.stringify(offerte, null, 2));
}

function leggiContatti() {
  assicuraArchivioDati();
  return JSON.parse(fs.readFileSync(fileContatti, "utf8"));
}

function salvaContatti(contatti) {
  fs.writeFileSync(fileContatti, JSON.stringify(contatti, null, 2));
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

  if (pathname === "/api/import" && req.method === "POST") {
    try {
      const body = await leggiBody(req);
      const nuoviContatti = Array.isArray(body.contatti) ? body.contatti : [];
      if (!nuoviContatti.length) {
        inviaJson(res, 400, { errore: "Nessun contatto trovato nel file" });
        return;
      }

      const normalizzati = nuoviContatti.map(arricchisciContatto);
      const mappa = new Map();
      [...contatti, ...normalizzati].forEach((contatto) => {
        const chiave = `${contatto.nome.toLowerCase()}|${contatto.azienda.toLowerCase()}`;
        mappa.set(chiave, contatto);
      });

      const unificati = Array.from(mappa.values());
      salvaContatti(unificati);
      inviaJson(res, 200, {
        importati: normalizzati.length,
        totale: unificati.length,
        contatti: unificati,
        riepilogo: riepilogaContatti(unificati)
      });
    } catch (errore) {
      inviaJson(res, 400, { errore: "Payload import non valido" });
    }
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

server.listen(PORTA, () => {
  assicuraArchivioDati();
  console.log(`Aito Business in esecuzione su http://localhost:${PORTA}`);
});
