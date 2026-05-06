const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validaNomeFileZip,
  validaMagicBytesZip,
  isPercorsoZipSicuro,
  csvToRecords,
  chiaveDeduplicaContatto,
  trovaMatchContatto,
  creaJobImportazione,
  analizzaContattoConAi,
  importaRecordsNelCrm,
  serializzaRecordAnteprima
} = require("../lib/importazioni-linkedin");
const { tentaParseJsonAi } = require("../lib/ai-provider");
const { creaUtentePayload } = require("../lib/auth");
const { arricchisciContatto } = require("../lib/crm");

test("valida file ZIP per nome ed header", () => {
  assert.equal(validaNomeFileZip("linkedin-export.zip"), true);
  assert.equal(validaNomeFileZip("linkedin-export.csv"), false);
  assert.equal(validaMagicBytesZip(Buffer.from([0x50, 0x4b, 0x03, 0x04])), true);
  assert.equal(validaMagicBytesZip(Buffer.from("ciao")), false);
});

test("blocca percorsi ZIP non sicuri", () => {
  assert.equal(isPercorsoZipSicuro("Connections/connections.csv"), true);
  assert.equal(isPercorsoZipSicuro("../evil.txt"), false);
  assert.equal(isPercorsoZipSicuro("C:/temp/evil.txt"), false);
});

test("parsa CSV LinkedIn con header semplici", () => {
  const csv = [
    'First Name,Last Name,Company,Position,Email Address',
    'Marco,Rinaldi,ScaleForge,Head of Sales,marco@example.com'
  ].join("\n");
  const righe = csvToRecords(csv);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].first_name, "Marco");
  assert.equal(righe[0].company, "ScaleForge");
});

test("parsa Connections.csv LinkedIn con righe di nota prima dell'header", () => {
  const csv = [
    "Notes:",
    '"Quando esporti i contatti alcune email possono mancare"',
    "",
    "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
    "Emilio,Capozza,https://www.linkedin.com/in/emilio-capozza-51ba85164,,me stesso - myself,Dottore commercialista,23 Apr 2026"
  ].join("\n");
  const righe = csvToRecords(csv);
  assert.equal(righe.length, 1);
  assert.equal(righe[0].first_name, "Emilio");
  assert.equal(righe[0].url, "https://www.linkedin.com/in/emilio-capozza-51ba85164");
  assert.equal(righe[0].connected_on, "23 Apr 2026");
});

test("ignora file profilo e contatti vuoti nella struttura LinkedIn reale", async () => {
  const { scansionaArchivioLinkedin } = require("../lib/importazioni-linkedin");
  const entries = [
    {
      nome: "Profile.csv",
      contenuto: Buffer.from("First Name,Last Name\nLorenzo,Tettine")
    },
    {
      nome: "Connections.csv",
      contenuto: Buffer.from([
        "Notes:",
        '"nota"',
        "",
        "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
        ",,,,,,",
        "Emilio,Capozza,https://www.linkedin.com/in/emilio-capozza-51ba85164,,me stesso - myself,Dottore commercialista,23 Apr 2026"
      ].join("\n"))
    }
  ];
  const risultato = scansionaArchivioLinkedin(entries);
  assert.equal(risultato.contatti.length, 1);
  assert.equal(risultato.contatti[0].fullName, "Emilio Capozza");
});

test("i contatti da ImportedContacts partono in revisione", () => {
  const { costruisciPreviewRecord } = require("../lib/importazioni-linkedin");
  const record = costruisciPreviewRecord({
    contattoNormalizzato: {
      fullName: "Mario Rossi",
      jobTitle: "Founder",
      company: "Studio Rossi",
      industry: "Consulenza",
      sourceFile: "ImportedContacts.csv",
      sourceKind: "imported_contacts"
    },
    conversazioniContatto: [],
    analisi: {
      contact_summary: "Contatto importato.",
      recommended_pipeline: "Pipeline commerciale",
      recommended_stage: "Da contattare",
      priority: "media",
      tags: ["imported"],
      notes: "Da verificare",
      confidence: 0.38
    },
    erroreAi: "",
    matchEsistente: null
  });
  assert.equal(record.status, "needs_review");
  assert.equal(record.sourceLabel, "Contatti importati");
});

test("i contatti imported molto deboli vengono esclusi automaticamente", () => {
  const { costruisciPreviewRecord } = require("../lib/importazioni-linkedin");
  const record = costruisciPreviewRecord({
    contattoNormalizzato: {
      fullName: "Mario",
      jobTitle: "",
      company: "",
      email: "",
      phone: "",
      linkedinProfileUrl: "",
      sourceFile: "ImportedContacts.csv",
      sourceKind: "imported_contacts"
    },
    conversazioniContatto: [],
    analisi: {
      contact_summary: "Contatto molto debole.",
      recommended_pipeline: "Pipeline commerciale",
      recommended_stage: "Da contattare",
      priority: "bassa",
      tags: [],
      notes: "",
      confidence: 0.2
    },
    erroreAi: "",
    matchEsistente: null
  });
  assert.equal(record.status, "excluded");
  assert.equal(record.exclude, true);
});

test("deduplica per email e URL LinkedIn", () => {
  const esistenti = [
    arricchisciContatto({
      id: "c1",
      nome: "Marco Rinaldi",
      azienda: "ScaleForge",
      ruolo: "Head of Sales",
      email: "marco@example.com",
      linkedinProfileUrl: "https://linkedin.com/in/marco-rinaldi"
    })
  ];

  const matchEmail = trovaMatchContatto(
    {
      fullName: "Marco Rinaldi",
      company: "ScaleForge",
      jobTitle: "Head of Sales",
      email: "marco@example.com",
      linkedinProfileUrl: ""
    },
    esistenti
  );
  assert.equal(matchEmail?.id, "c1");

  const matchUrl = trovaMatchContatto(
    {
      fullName: "Marco Rinaldi",
      company: "ScaleForge",
      jobTitle: "Head of Sales",
      email: "",
      linkedinProfileUrl: "https://linkedin.com/in/marco-rinaldi"
    },
    esistenti
  );
  assert.equal(matchUrl?.id, "c1");

  const chiave = chiaveDeduplicaContatto({
    fullName: "Marco Rinaldi",
    company: "ScaleForge",
    jobTitle: "Head of Sales"
  });
  assert.equal(chiave.nomeAzienda, "marco rinaldi|scaleforge");
});

test("crea job importazione con stato iniziale corretto", () => {
  const job = creaJobImportazione({
    userId: "utente-1",
    nomeFileOriginale: "linkedin.zip",
    dimensioneFile: 1024
  });
  assert.equal(job.userId, "utente-1");
  assert.equal(job.status, "uploaded");
  assert.equal(job.metadata.stepStates.length > 0, true);
});

test("parse AI valido e invalido", () => {
  assert.deepEqual(tentaParseJsonAi('{"ok":true}'), { ok: true });
  assert.equal(tentaParseJsonAi("risposta non json"), null);
});

test("se manca la API key l'analisi AI ripiega sulle regole", async () => {
  const risposta = await analizzaContattoConAi({
    contattoNormalizzato: {
      fullName: "Giulia Conti",
      company: "Opero Studio",
      jobTitle: "Founder",
      industry: "Agenzia",
      location: "Roma",
      connectedAt: "2026-04-10"
    },
    conversazioniContatto: [],
    impostazioniAi: null
  });
  assert.equal(risposta.origine, "regole");
  assert.equal(Boolean(risposta.analisi.recommended_stage), true);
});

test("importa record nel CRM creando e aggiornando contatti", () => {
  const esistenti = [
    arricchisciContatto({
      id: "c1",
      nome: "Marco Rinaldi",
      ruolo: "Head of Sales",
      azienda: "ScaleForge",
      email: "marco@example.com",
      tag: ["ICP"]
    })
  ];

  const records = [
    {
      id: "r1",
      status: "duplicate",
      exclude: false,
      matchedContactId: "c1",
      normalizedData: {
        fullName: "Marco Rinaldi",
        jobTitle: "Head of Sales",
        company: "ScaleForge",
        email: "marco@example.com",
        phone: "",
        linkedinProfileUrl: ""
      },
      suggestedPipeline: "Pipeline commerciale",
      suggestedStage: "Contattato",
      tagSuggeriti: ["SaaS"],
      ultimaConversazione: "2026-04-20",
      note: "Nota AI"
    },
    {
      id: "r2",
      status: "ready",
      exclude: false,
      matchedContactId: "",
      normalizedData: {
        fullName: "Sara Ferri",
        jobTitle: "Partnership Manager",
        company: "Growth Studio",
        email: "sara@example.com",
        phone: "",
        linkedinProfileUrl: ""
      },
      suggestedPipeline: "Pipeline partnership",
      suggestedStage: "Da contattare",
      tagSuggeriti: ["Potenziale Partner"],
      ultimaConversazione: "",
      note: ""
    }
  ];

  const esito = importaRecordsNelCrm({ contattiEsistenti: esistenti, records });
  assert.equal(esito.creati, 1);
  assert.equal(esito.modificati, 1);
  assert.equal(esito.contatti.length, 2);
  assert.equal(esito.contatti[0].tag.includes("SaaS"), true);
});

test("serializza record anteprima senza rawData sensibili", () => {
  const record = serializzaRecordAnteprima({
    id: "r1",
    type: "contact",
    status: "ready",
    exclude: false,
    sourceFile: "connections.csv",
    normalizedData: { fullName: "Test" },
    aiAnalysis: { contact_summary: "Sintesi" },
    suggestedPipeline: "Pipeline commerciale",
    suggestedStage: "Da contattare",
    matchedContactId: "",
    errorMessage: "",
    tagSuggeriti: [],
    priorita: "Media",
    tipologiaContatto: "Potenziale Cliente",
    note: "",
    confidenceScore: 0.6,
    ultimaConversazione: "",
    motivazione: "Sintesi"
  });
  assert.equal(record.id, "r1");
  assert.equal("rawData" in record, false);
});

test("crea utente standard di default e admin quando richiesto", () => {
  const utente = creaUtentePayload({
    nome: "Utente Base",
    email: "base@example.com",
    password: "Password123!"
  });
  const admin = creaUtentePayload({
    nome: "Admin",
    email: "admin@example.com",
    password: "Password123!",
    ruolo: "admin"
  });

  assert.equal(utente.ruolo, "utente");
  assert.equal(admin.ruolo, "admin");
  assert.equal(utente.email, "base@example.com");
});
