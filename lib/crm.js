const { randomUUID } = require("crypto");

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
    timeline: [{ id: "t6", tipo: "import", data: "2026-03-28", testo: "Importato da export LinkedIn." }]
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

function today() {
  return new Date().toISOString().slice(0, 10);
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
    Contattato: `Ciao ${contatto.nome}, torno sul mio messaggio precedente: se vuoi ti mando un esempio concreto di flusso commerciale applicato a ${contatto.azienda}.`,
    "Follow-up call effettuata": `Ciao ${contatto.nome}, grazie ancora per la call. Ti invio volentieri la proposta con i prossimi step operativi per ${contatto.azienda}.`,
    "Follow-up post call": `Ciao ${contatto.nome}, riprendo il confronto della call per capire come preferisci procedere. Posso mandarti un recap finale con offerta e tempistiche.`,
    Abbonato: `Ciao ${contatto.nome}, sto preparando alcune opportunita per aumentare ancora il valore generato da Aito Business per ${contatto.azienda}.`,
    Disdettato: `Ciao ${contatto.nome}, volevo capire se ha senso riaprire il confronto ora che abbiamo introdotto nuove funzionalita nel prodotto.`,
    KO: `Ciao ${contatto.nome}, grazie comunque del confronto. Se in futuro il tema tornera prioritario, resto disponibile.`,
    "Non in target": `Ciao ${contatto.nome}, grazie del collegamento. Al momento non vedo un fit diretto, ma restiamo in contatto.`
  };
  return messaggi[contatto.stato] || `Ciao ${contatto.nome}, possiamo fissare un rapido confronto per capire se Aito Business puo aiutare ${contatto.azienda}?`;
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
    pipelineNome: contattoGrezzo.pipelineNome || contattoGrezzo.pipeline || "Pipeline commerciale",
    tag: Array.isArray(contattoGrezzo.tag)
      ? contattoGrezzo.tag
      : typeof contattoGrezzo.tag === "string"
        ? contattoGrezzo.tag.split(",").map((valore) => valore.trim()).filter(Boolean)
        : Array.isArray(contattoGrezzo.tags)
          ? contattoGrezzo.tags
          : [],
    intento: contattoGrezzo.intento || contattoGrezzo.intent || "Media",
    sentiment: contattoGrezzo.sentiment || "Neutro",
    email: contattoGrezzo.email || "",
    telefono: contattoGrezzo.telefono || contattoGrezzo.phone || "",
    linkedinProfileUrl: contattoGrezzo.linkedinProfileUrl || contattoGrezzo.linkedin_url || "",
    timeline: Array.isArray(contattoGrezzo.timeline)
      ? contattoGrezzo.timeline.map((evento) => ({
          id: evento.id || randomUUID(),
          tipo: evento.tipo || evento.type || "nota",
          data: evento.data || evento.date || today(),
          testo: evento.testo || evento.text || ""
        }))
      : []
  };

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
  return OFFERTE_PREDEFINITE.find((offerta) => offerta.id === id);
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

module.exports = {
  STATI_PIPELINE,
  OFFERTE_PREDEFINITE,
  CONTATTI_PREDEFINITI,
  promptAi,
  today,
  classificaTipologiaContatto,
  calcolaPriorita,
  determinaStato,
  stimaOffertePerContatto,
  costruisciInsight,
  costruisciProssimaAzione,
  costruisciMessaggioSuggerito,
  arricchisciContatto,
  riepilogaContatti,
  costruisciPipeline,
  trovaOfferta,
  generaSuggerimentoAi
};
