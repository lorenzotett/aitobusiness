const statoApp = {
  contatti: [],
  riepilogo: null,
  promptAi: {},
  statiPipeline: [],
  offerte: [],
  limiteZipBytes: 0,
  sessione: {
    autenticato: false,
    utente: null
  },
  admin: {
    utenti: [],
    riepilogo: null
  },
  impostazioniAi: null,
  importazioneLinkedin: {
    job: null,
    records: [],
    riepilogo: null,
    filtroFonte: "tutti"
  },
  filtri: {
    query: "",
    stato: "",
    localita: "",
    livelloPriorita: "",
    tipologiaContatto: ""
  }
};

const shellApp = document.querySelector(".app-shell");
const sidebar = document.querySelector(".sidebar");
const areaPrincipale = document.getElementById("main-content");
const pannelloAi = document.getElementById("assistant-panel");
let debounceRicerca = null;
let idContattoDrag = null;
const COLORI_GRAFICI = ["#0d7a6b", "#b77118", "#a1543e", "#445b53", "#49af98", "#d3a458", "#7f8b85"];

function utenteAdmin() {
  return ["admin", "owner"].includes(String(statoApp.sessione.utente?.ruolo || "").toLowerCase());
}

function impostaLayout(modalita) {
  document.body.classList.remove("layout-public", "layout-auth", "layout-admin", "layout-workspace");
  document.body.classList.add(`layout-${modalita}`);
  const mostraWorkspace = modalita === "workspace";
  sidebar.hidden = !mostraWorkspace;
  pannelloAi.hidden = !mostraWorkspace;
  shellApp.dataset.layout = modalita;
}

function escapeHtml(valore = "") {
  return String(valore)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formattaData(valore) {
  if (!valore) return "-";
  return new Intl.DateTimeFormat("it-IT", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(valore));
}

function oggi() {
  return new Date().toISOString().slice(0, 10);
}

function iniziali(nome = "") {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() || "")
    .join("");
}

function slugStato(stato = "") {
  return stato.toLowerCase().replaceAll(" ", "-");
}

function mostraToast(messaggio) {
  const esistente = document.querySelector(".toast");
  if (esistente) esistente.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = messaggio;
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

function impostaCaricamentoBottone(bottone, attivo, etichetta) {
  if (!bottone) return;
  if (attivo) {
    bottone.dataset.etichettaOriginale = bottone.textContent;
    bottone.disabled = true;
    bottone.classList.add("is-busy");
    bottone.textContent = etichetta || "Attendo...";
    return;
  }
  bottone.disabled = false;
  bottone.classList.remove("is-busy");
  if (bottone.dataset.etichettaOriginale) {
    bottone.textContent = bottone.dataset.etichettaOriginale;
    delete bottone.dataset.etichettaOriginale;
  }
}

async function conBottoneInCaricamento(bottone, etichetta, task) {
  try {
    impostaCaricamentoBottone(bottone, true, etichetta);
    return await task();
  } catch (errore) {
    mostraToast(errore.message || "Errore imprevisto");
    throw errore;
  } finally {
    impostaCaricamentoBottone(bottone, false);
  }
}

async function eseguiLogout(destinazione = "/") {
  await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) });
  statoApp.sessione = { autenticato: false, utente: null };
  statoApp.admin = { utenti: [], riepilogo: null };
  statoApp.contatti = [];
  statoApp.importazioneLinkedin = { job: null, records: [], riepilogo: null, filtroFonte: "tutti" };
  navigate(destinazione);
}

async function api(percorso, opzioni = {}) {
  const headers = { ...(opzioni.headers || {}) };
  if (!(opzioni.body instanceof FormData) && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  const risposta = await fetch(percorso, {
    ...opzioni,
    headers
  });
  const payload = await risposta.json();
  if (!risposta.ok) {
    const errore = new Error(payload.messaggio || payload.errore || "Richiesta fallita");
    errore.status = risposta.status;
    throw errore;
  }
  return payload;
}

function trovaContatto(id) {
  return statoApp.contatti.find((contatto) => contatto.id === id);
}

function trovaOfferta(id) {
  return statoApp.offerte.find((offerta) => offerta.id === id);
}

function offerteProposte(contatto) {
  return (contatto.offerteProposteIds || []).map(trovaOfferta).filter(Boolean);
}

function offerteSottoscritte(contatto) {
  return (contatto.offerteSottoscritteIds || []).map(trovaOfferta).filter(Boolean);
}

function contattiFiltrati() {
  return statoApp.contatti.filter((contatto) => {
    const sorgente = [contatto.nome, contatto.ruolo, contatto.azienda, contatto.localita, contatto.tipologiaContatto].join(" ").toLowerCase();
    const queryOk = !statoApp.filtri.query || sorgente.includes(statoApp.filtri.query.toLowerCase());
    const statoOk = !statoApp.filtri.stato || contatto.stato === statoApp.filtri.stato;
    const localitaOk = !statoApp.filtri.localita || contatto.localita.toLowerCase().includes(statoApp.filtri.localita.toLowerCase());
    const prioritaOk = !statoApp.filtri.livelloPriorita || contatto.livelloPriorita === statoApp.filtri.livelloPriorita;
    const tipologiaOk = !statoApp.filtri.tipologiaContatto || contatto.tipologiaContatto === statoApp.filtri.tipologiaContatto;
    return queryOk && statoOk && localitaOk && prioritaOk && tipologiaOk;
  });
}

function aggiornaMetaSidebar() {
  const sessionBox = document.getElementById("sidebar-session");
  if (!statoApp.sessione.autenticato) {
    document.querySelector('[data-nav-badge="dashboard"]').textContent = "-";
    document.querySelector('[data-nav-badge="contacts"]').textContent = "-";
    document.querySelector('[data-nav-badge="pipeline"]').textContent = "-";
    document.querySelector('[data-nav-badge="offers"]').textContent = "-";
    document.querySelector('[data-nav-badge="analytics"]').textContent = "-";
    document.querySelector('[data-nav-badge="suggestions"]').textContent = "-";
    document.querySelector('[data-nav-badge="upload"]').textContent = "-";
    document.getElementById("sidebar-focus").textContent = "Accedi per aprire il tuo workspace.";
    document.getElementById("sidebar-summary").textContent = "Sessione protetta, dati separati e importazioni visibili solo al proprietario.";
    if (sessionBox) sessionBox.innerHTML = "";
    return;
  }
  const focus = [...statoApp.contatti].sort((a, b) => b.punteggioLead - a.punteggioLead)[0];
  document.querySelector('[data-nav-badge="dashboard"]').textContent = statoApp.contatti.length;
  document.querySelector('[data-nav-badge="contacts"]').textContent = statoApp.contatti.length;
  document.querySelector('[data-nav-badge="pipeline"]').textContent = statoApp.statiPipeline.length;
  document.querySelector('[data-nav-badge="offers"]').textContent = statoApp.offerte.length;
  document.querySelector('[data-nav-badge="analytics"]').textContent = "Live";
  document.querySelector('[data-nav-badge="suggestions"]').textContent = statoApp.contatti.filter((contatto) => contatto.livelloPriorita === "Alta").length;
  document.querySelector('[data-nav-badge="upload"]').textContent = statoApp.importazioneLinkedin.records.length || "ZIP";

  document.getElementById("sidebar-focus").textContent = focus
    ? `Priorita alta: ${focus.nome} - ${focus.azienda}.`
    : "Costruisci la pipeline.";
  document.getElementById("sidebar-summary").textContent = `${statoApp.contatti.filter((contatto) => contatto.stato === "Da contattare").length} da contattare, ${statoApp.contatti.filter((contatto) => contatto.stato === "Abbonato").length} abbonati, ${statoApp.contatti.filter((contatto) => contatto.tipologiaContatto === "Potenziale Partner").length} partner potenziali.`;
  if (sessionBox) {
    sessionBox.innerHTML = `
      <div class="sidebar-session-meta">
        <span>${escapeHtml(statoApp.sessione.utente?.email || "")}</span>
        <button class="small-btn" id="logout-btn">Logout</button>
      </div>
    `;
    document.getElementById("logout-btn")?.addEventListener("click", async () => {
      await eseguiLogout("/");
    });
  }
}

function impostaMenuAttivo() {
  document.querySelectorAll("[data-link]").forEach((link) => {
    const href = link.getAttribute("href");
    const dettaglio = href === "/contatti" && window.location.pathname.startsWith("/contatti/");
    link.classList.toggle("active", window.location.pathname === href || dettaglio);
  });
}

async function caricaDati() {
  const payloadSessione = await api("/api/auth/session");
  statoApp.sessione = payloadSessione;
  if (!payloadSessione.autenticato) {
    return;
  }

  const [payloadContatti, payloadPrompt, payloadMetadati, payloadAi] = await Promise.all([
    api("/api/contatti"),
    api("/api/prompt-ai"),
    api("/api/metadati"),
    api("/api/impostazioni/ai-provider")
  ]);

  statoApp.contatti = payloadContatti.contatti;
  statoApp.riepilogo = payloadContatti.riepilogo;
  statoApp.promptAi = payloadPrompt;
  statoApp.statiPipeline = payloadMetadati.statiPipeline;
  statoApp.offerte = payloadMetadati.offerte;
  statoApp.limiteZipBytes = payloadMetadati.limiteZipBytes || 0;
  statoApp.impostazioniAi = payloadAi.impostazioni;
  aggiornaMetaSidebar();
}

async function caricaAdmin() {
  const payload = await api("/api/admin/utenti");
  statoApp.admin = {
    utenti: payload.utenti || [],
    riepilogo: payload.riepilogo || null
  };
}

async function aggiornaContatto(id, payload, messaggio) {
  const risposta = await api(`/api/contatti/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload)
  });
  statoApp.contatti = statoApp.contatti.map((contatto) => (contatto.id === id ? risposta.contatto : contatto));
  statoApp.riepilogo = risposta.riepilogo;
  aggiornaMetaSidebar();
  if (messaggio) mostraToast(messaggio);
  return risposta.contatto;
}

async function generaSuggerimentoAi(id) {
  const risposta = await api("/api/ai/genera", {
    method: "POST",
    body: JSON.stringify({ contattoId: id })
  });
  statoApp.contatti = statoApp.contatti.map((contatto) => (contatto.id === id ? risposta.contatto : contatto));
  aggiornaMetaSidebar();
  mostraToast("Suggerimento aggiornato");
  renderRoute(risposta.contatto);
}

async function copiaTesto(testo, bottone) {
  try {
    await navigator.clipboard.writeText(testo);
  } catch (errore) {
    const fallback = document.createElement("textarea");
    fallback.value = testo;
    document.body.appendChild(fallback);
    fallback.select();
    document.execCommand("copy");
    fallback.remove();
  }
  if (bottone) bottone.textContent = "Copiato";
  mostraToast("Messaggio copiato");
}

function renderMetricCard(titolo, valore, dettaglio, classe = "") {
  return `
    <article class="metric-card ${classe}">
      <span class="eyebrow">${escapeHtml(titolo)}</span>
      <strong>${escapeHtml(String(valore))}</strong>
      <p class="subtle">${escapeHtml(dettaglio)}</p>
    </article>
  `;
}

function contattiConCall(lista) {
  return lista.filter(
    (contatto) =>
      contatto.timeline.some((evento) => evento.tipo === "call") ||
      ["Follow-up call effettuata", "Follow-up post call", "Abbonato", "Disdettato"].includes(contatto.stato)
  );
}

function distribuzioneFrequenza(lista, estraiValore) {
  const mappa = new Map();
  lista.forEach((elemento) => {
    const chiave = estraiValore(elemento) || "Non definito";
    mappa.set(chiave, (mappa.get(chiave) || 0) + 1);
  });
  return Array.from(mappa.entries())
    .map(([etichetta, valore], index) => ({ etichetta, valore, colore: COLORI_GRAFICI[index % COLORI_GRAFICI.length] }))
    .sort((a, b) => b.valore - a.valore);
}

function distribuzioneStati(lista) {
  const totale = Math.max(1, lista.length);
  return statoApp.statiPipeline.map((stato, index) => {
    const valore = lista.filter((contatto) => contatto.stato === stato).length;
    return {
      stato,
      valore,
      percentuale: Math.round((valore / totale) * 100),
      colore: COLORI_GRAFICI[index % COLORI_GRAFICI.length]
    };
  });
}

function buildConicGradient(voci) {
  const totale = voci.reduce((somma, voce) => somma + voce.valore, 0);
  if (!totale) return "conic-gradient(#e5ded2 0deg 360deg)";

  let accumulato = 0;
  const segmenti = voci.map((voce) => {
    const inizio = accumulato;
    const gradi = (voce.valore / totale) * 360;
    accumulato += gradi;
    return `${voce.colore} ${inizio}deg ${accumulato}deg`;
  });
  return `conic-gradient(${segmenti.join(", ")})`;
}

function renderCardTorta(titolo, voci) {
  const totale = voci.reduce((somma, voce) => somma + voce.valore, 0);
  return `
    <article class="chart-card">
      <div class="section-head">
        <div>
          <span class="eyebrow">Grafico a torta</span>
          <h3>${escapeHtml(titolo)}</h3>
        </div>
        <strong>${totale}</strong>
      </div>
      <div class="chart-pie-wrap">
        <div class="chart-pie" style="background:${buildConicGradient(voci)}"></div>
        <div class="chart-legend">
          ${
            voci.length
              ? voci
                  .map(
                    (voce) => `
                      <div class="legend-item">
                        <span class="legend-swatch" style="background:${voce.colore}"></span>
                        <span>${escapeHtml(voce.etichetta)}</span>
                        <strong>${voce.valore}</strong>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="subtle">Nessun dato disponibile</div>`
          }
        </div>
      </div>
    </article>
  `;
}

function renderCardBarre(titolo, serie) {
  const massimo = Math.max(1, ...serie.map((voce) => voce.valore));
  return `
    <article class="chart-card chart-card-wide">
      <div class="section-head">
        <div>
          <span class="eyebrow">Grafico a barre</span>
          <h3>${escapeHtml(titolo)}</h3>
        </div>
      </div>
      <div class="bar-chart">
        ${serie
          .map(
            (voce) => `
              <div class="bar-row">
                <span class="bar-label">${escapeHtml(voce.stato)}</span>
                <div class="bar-track">
                  <div class="bar-fill" style="width:${(voce.valore / massimo) * 100}%; background:${voce.colore}"></div>
                </div>
                <strong>${voce.valore}</strong>
              </div>
            `
          )
          .join("")}
      </div>
    </article>
  `;
}

function contattiAssociatiAOfferta(idOfferta) {
  return statoApp.contatti.filter(
    (contatto) => (contatto.offerteProposteIds || []).includes(idOfferta) || (contatto.offerteSottoscritteIds || []).includes(idOfferta)
  );
}

function renderPannelloAi(contatto) {
  const focus = contatto || statoApp.contatti[0];
  if (!focus) {
    pannelloAi.innerHTML = `<div class="sticky"><span class="eyebrow">Assistente AI</span><h2>Nessun contatto</h2></div>`;
    return;
  }

  pannelloAi.innerHTML = `
    <div class="sticky assistant-stack">
      <div class="assistant-hero tone-${slugStato(focus.stato)}">
        <div>
          <span class="eyebrow">Assistente AI</span>
          <h2>${escapeHtml(focus.stato)}</h2>
          <p>${escapeHtml(focus.insight)}</p>
        </div>
        <div class="score-orb">
          <span>Priorita</span>
          <strong>${escapeHtml(focus.livelloPriorita)}</strong>
        </div>
      </div>

      <div class="panel-card">
        <span class="eyebrow">Classificazione</span>
        <div class="assistant-meta-grid">
          <div><span>Tipologia</span><strong>${escapeHtml(focus.tipologiaContatto)}</strong></div>
          <div><span>Punteggio</span><strong>${focus.punteggioLead}</strong></div>
          <div><span>Ruolo</span><strong>${escapeHtml(focus.ruolo)}</strong></div>
          <div><span>Azienda</span><strong>${escapeHtml(focus.azienda)}</strong></div>
        </div>
      </div>

      <div class="panel-card">
        <span class="eyebrow">Messaggio suggerito</span>
        <h3>${escapeHtml(focus.prossimaAzione)}</h3>
        <p>${escapeHtml(focus.messaggioSuggerito)}</p>
        <div class="actions-row">
          <button class="btn" id="copy-messaggio-ai">Copy</button>
          <button class="ghost-btn" id="refresh-ai">Refresh AI</button>
        </div>
      </div>

      <div class="panel-card">
        <span class="eyebrow">Offerte assegnate</span>
        <div class="offer-mini-list">
          ${offerteProposte(focus)
            .map(
              (offerta) => `
                <div class="offer-mini-item">
                  <strong>${escapeHtml(offerta.nome)}</strong>
                  <span>${escapeHtml(offerta.tipologia)} · ${escapeHtml(offerta.prezzo)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
    </div>
  `;

  document.getElementById("copy-messaggio-ai")?.addEventListener("click", (event) => copiaTesto(focus.messaggioSuggerito, event.currentTarget));
  document.getElementById("refresh-ai")?.addEventListener("click", (event) =>
    conBottoneInCaricamento(event.currentTarget, "Aggiorno...", () => generaSuggerimentoAi(focus.id))
  );
}

function renderDashboard() {
  const top = [...statoApp.contatti].sort((a, b) => b.punteggioLead - a.punteggioLead).slice(0, 4);
  areaPrincipale.innerHTML = `
    <section class="hero-panel">
      <div class="hero-copy">
        <span class="eyebrow">CRM completo</span>
        <h1>Pipeline, contatti e offerte collegate in un unico flusso.</h1>
        <p>Aito Business distingue clienti e partner, collega offerte commerciali e partnership, salva gli stati reali della pipeline e guida il team dalla prima chat fino all'abbonamento.</p>
        <div class="hero-actions">
          <a class="btn" href="/contatti" data-link>Apri contatti</a>
          <a class="ghost-btn" href="/pipeline" data-link>Apri pipeline</a>
        </div>
      </div>
      <div class="hero-aside">
        <div class="hero-chip">
          <span>Abbonati</span>
          <strong>${statoApp.contatti.filter((contatto) => contatto.stato === "Abbonato").length}</strong>
        </div>
        <div class="hero-stack">
          <div class="hero-mini-card">
            <span class="eyebrow">Partner potenziali</span>
            <strong>${statoApp.contatti.filter((contatto) => contatto.tipologiaContatto === "Potenziale Partner").length}</strong>
            <p>Contatti da valorizzare in partnership</p>
          </div>
          <div class="hero-mini-card">
            <span class="eyebrow">Priorita alta</span>
            <strong>${statoApp.contatti.filter((contatto) => contatto.livelloPriorita === "Alta").length}</strong>
            <p>Lead da lavorare subito</p>
          </div>
        </div>
      </div>
    </section>

    <section class="metrics-grid">
      ${renderMetricCard("Contatti", statoApp.contatti.length, "Lead e partner in piattaforma", "metric-ink")}
      ${renderMetricCard("Da contattare", statoApp.contatti.filter((contatto) => contatto.stato === "Da contattare").length, "Lead ancora da attivare", "metric-accent")}
      ${renderMetricCard("Follow-up post call", statoApp.contatti.filter((contatto) => contatto.stato === "Follow-up post call").length, "Lead in chiusura", "metric-gold")}
      ${renderMetricCard("Offerte", statoApp.offerte.length, "Catalogo azienda e partner", "metric-muted")}
    </section>

    <section class="dashboard-grid">
      <article class="panel-card">
        <div class="section-head">
          <div>
            <span class="eyebrow">Priorita commerciali</span>
            <h3>Contatti da lavorare oggi</h3>
          </div>
        </div>
        <div class="priority-list">
          ${top
            .map(
              (contatto) => `
                <button class="priority-item" data-dettaglio="${contatto.id}">
                  <span class="avatar">${iniziali(contatto.nome)}</span>
                  <span class="priority-copy">
                    <strong>${escapeHtml(contatto.nome)}</strong>
                    <span>${escapeHtml(contatto.ruolo)} · ${escapeHtml(contatto.tipologiaContatto)}</span>
                  </span>
                  <span class="priority-meta">
                    <span class="pill tone-${slugStato(contatto.stato)}">${escapeHtml(contatto.stato)}</span>
                    <strong>${escapeHtml(contatto.livelloPriorita)}</strong>
                  </span>
                </button>
              `
            )
            .join("")}
        </div>
      </article>

      <article class="panel-card">
        <div class="section-head">
          <div>
            <span class="eyebrow">Offerte attive</span>
            <h3>Catalogo collegabile</h3>
          </div>
        </div>
        <div class="offer-mini-list">
          ${statoApp.offerte
            .map(
              (offerta) => `
                <div class="offer-mini-item">
                  <strong>${escapeHtml(offerta.nome)}</strong>
                  <span>${escapeHtml(offerta.tipologia)} · ${escapeHtml(offerta.prezzo)} · Partner ${escapeHtml(offerta.percentualePartner)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </article>
    </section>
  `;

  bindDettaglioContatto();
}

function renderRigaContatto(contatto) {
  const primaOfferta = offerteProposte(contatto)[0];
  return `
    <tr>
      <td>
        <div class="contact-cell">
          <span class="avatar">${iniziali(contatto.nome)}</span>
          <div class="contact-primary">
            <strong>${escapeHtml(contatto.nome)}</strong>
            <span>${escapeHtml(contatto.localita)}</span>
          </div>
        </div>
      </td>
      <td><strong>${escapeHtml(contatto.ruolo)}</strong></td>
      <td>
        <div class="company-cell">
          <strong>${escapeHtml(contatto.azienda)}</strong>
          <span>${escapeHtml(contatto.settore || "-")}</span>
        </div>
      </td>
      <td><span class="pill lead-type-pill">${escapeHtml(contatto.tipologiaContatto)}</span></td>
      <td><span class="pill priority-pill priority-${contatto.livelloPriorita.toLowerCase()}">${escapeHtml(contatto.livelloPriorita)}</span></td>
      <td><span class="pill tone-${slugStato(contatto.stato)}">${escapeHtml(contatto.stato)}</span></td>
      <td>
        ${
          primaOfferta
            ? `<div class="offer-link-cell"><strong>${escapeHtml(primaOfferta.nome)}</strong><span>${escapeHtml(primaOfferta.tipologia)} · ${escapeHtml(primaOfferta.prezzo)}</span></div>`
            : `<span class="subtle">Nessuna</span>`
        }
      </td>
      <td>
        <div class="actions-row">
          <button class="small-btn" data-dettaglio="${contatto.id}">Open</button>
          <button class="small-btn" data-copy="${contatto.id}">Copy</button>
        </div>
      </td>
    </tr>
  `;
}

function renderContatti() {
  const contatti = contattiFiltrati();
  areaPrincipale.innerHTML = `
    <section class="page-header">
      <div>
        <span class="eyebrow">Vista contatti</span>
        <h1>Contatti</h1>
        <p>Tabella CRM con ruolo separato, tipologia intelligente cliente o partner, priorita, stato e offerta collegata.</p>
      </div>
      <div class="header-actions">
        <a class="ghost-btn" href="/importa-linkedin" data-link>Importa LinkedIn</a>
        <button class="ghost-btn" id="reset-demo">Reset demo</button>
        <button class="btn" id="export-csv">Export CSV</button>
      </div>
    </section>

    <section class="filter-shell">
      <div class="filter-bar filter-bar-wide">
        <input id="filtro-query" placeholder="Cerca nome, ruolo, azienda..." value="${escapeHtml(statoApp.filtri.query)}" />
        <select id="filtro-stato">
          <option value="">Tutti gli stati</option>
          ${statoApp.statiPipeline.map((stato) => `<option value="${escapeHtml(stato)}">${escapeHtml(stato)}</option>`).join("")}
        </select>
        <input id="filtro-localita" placeholder="Filtra per localita" value="${escapeHtml(statoApp.filtri.localita)}" />
        <select id="filtro-priorita">
          <option value="">Tutte le priorita</option>
          <option value="Alta">Alta</option>
          <option value="Media">Media</option>
          <option value="Bassa">Bassa</option>
        </select>
        <select id="filtro-tipologia">
          <option value="">Tutte le tipologie</option>
          <option value="Potenziale Cliente">Potenziale Cliente</option>
          <option value="Potenziale Partner">Potenziale Partner</option>
        </select>
        <button class="ghost-btn" id="clear-filtri">Clear</button>
      </div>
      <div class="filter-summary">
        <span>${contatti.length} righe visibili</span>
        <span>${Object.values(statoApp.filtri).filter(Boolean).length} filtri attivi</span>
      </div>
    </section>

    <section class="panel-card table-card contacts-card">
      <table class="contacts-table">
        <thead>
          <tr>
            <th>Nome</th>
            <th>Ruolo</th>
            <th>Azienda</th>
            <th>Tipologia</th>
            <th>Livello di Priorita</th>
            <th>Stato</th>
            <th>Offerta</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>
          ${contatti.length ? contatti.map(renderRigaContatto).join("") : `<tr><td colspan="8"><div class="empty-state"><strong>Nessun contatto trovato.</strong><p>Modifica i filtri o importa nuovi dati.</p></div></td></tr>`}
        </tbody>
      </table>
    </section>
  `;

  document.getElementById("filtro-stato").value = statoApp.filtri.stato;
  document.getElementById("filtro-priorita").value = statoApp.filtri.livelloPriorita;
  document.getElementById("filtro-tipologia").value = statoApp.filtri.tipologiaContatto;
  bindAzioniContatti();
}

function bindAzioniContatti() {
  document.getElementById("filtro-query")?.addEventListener("input", (event) => {
    window.clearTimeout(debounceRicerca);
    debounceRicerca = window.setTimeout(() => {
      statoApp.filtri.query = event.target.value;
      renderContatti();
      bindGlobalNavigation();
    }, 120);
  });

  [
    ["filtro-stato", "stato"],
    ["filtro-localita", "localita"],
    ["filtro-priorita", "livelloPriorita"],
    ["filtro-tipologia", "tipologiaContatto"]
  ].forEach(([id, chiave]) => {
    const evento = id === "filtro-localita" ? "input" : "change";
    document.getElementById(id)?.addEventListener(evento, (event) => {
      statoApp.filtri[chiave] = event.target.value;
      renderContatti();
      bindGlobalNavigation();
    });
  });

  document.getElementById("clear-filtri")?.addEventListener("click", () => {
    statoApp.filtri = { query: "", stato: "", localita: "", livelloPriorita: "", tipologiaContatto: "" };
    renderContatti();
    bindGlobalNavigation();
  });

  document.getElementById("reset-demo")?.addEventListener("click", (event) =>
    conBottoneInCaricamento(event.currentTarget, "Reset...", async () => {
      const risposta = await api("/api/reset", { method: "POST", body: JSON.stringify({}) });
      statoApp.contatti = risposta.contatti;
      statoApp.riepilogo = risposta.riepilogo;
      aggiornaMetaSidebar();
      renderRoute();
    })
  );

  document.getElementById("export-csv")?.addEventListener("click", esportaCsv);
  bindDettaglioContatto();

  document.querySelectorAll("[data-copy]").forEach((bottone) => {
    bottone.addEventListener("click", () => {
      const contatto = trovaContatto(bottone.dataset.copy);
      copiaTesto(contatto.messaggioSuggerito, bottone);
    });
  });
}

function esportaCsv() {
  const righe = [
    ["Nome", "Ruolo", "Azienda", "Tipologia", "Priorita", "Stato", "Offerta"],
    ...contattiFiltrati().map((contatto) => [
      contatto.nome,
      contatto.ruolo,
      contatto.azienda,
      contatto.tipologiaContatto,
      contatto.livelloPriorita,
      contatto.stato,
      offerteProposte(contatto)[0]?.nome || ""
    ])
  ];
  const csv = righe.map((riga) => riga.map((cella) => `"${String(cella).replaceAll('"', '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "aito-contatti.csv";
  link.click();
  URL.revokeObjectURL(url);
  mostraToast("CSV esportato");
}

async function renderDettaglioContatto(contatto) {
  if (!contatto) {
    navigate("/contatti");
    return;
  }

  const payload = await api(`/api/contatti/${contatto.id}`);
  const corrente = payload.contatto;
  statoApp.contatti = statoApp.contatti.map((item) => (item.id === corrente.id ? corrente : item));

  areaPrincipale.innerHTML = `
    <section class="page-header detail-title">
      <div>
        <span class="eyebrow">Scheda contatto</span>
        <h1>${escapeHtml(corrente.nome)}</h1>
        <p>${escapeHtml(corrente.ruolo)} · ${escapeHtml(corrente.azienda)} · ${escapeHtml(corrente.tipologiaContatto)}</p>
      </div>
      <div class="header-actions">
        <a class="ghost-btn" href="/contatti" data-link>Back</a>
        <button class="btn" id="copy-dettaglio">Copy</button>
      </div>
    </section>

    <section class="detail-grid">
      <div class="contact-card contact-summary-card">
        <div class="contact-hero">
          <span class="avatar large">${iniziali(corrente.nome)}</span>
          <div>
            <h2>${escapeHtml(corrente.nome)}</h2>
            <p>${escapeHtml(corrente.ruolo)} at ${escapeHtml(corrente.azienda)}</p>
          </div>
        </div>
        <div class="meta-grid">
          <div class="meta-tile"><span class="eyebrow">Tipologia</span><strong>${escapeHtml(corrente.tipologiaContatto)}</strong></div>
          <div class="meta-tile"><span class="eyebrow">Priorita</span><strong>${escapeHtml(corrente.livelloPriorita)}</strong></div>
          <div class="meta-tile"><span class="eyebrow">Stato</span><strong>${escapeHtml(corrente.stato)}</strong></div>
          <div class="meta-tile"><span class="eyebrow">Settore</span><strong>${escapeHtml(corrente.settore || "-")}</strong></div>
        </div>

        <div class="linked-offers-block">
          <span class="eyebrow">Offerte proposte</span>
          ${payload.offerteProposte
            .map(
              (offerta) => `
                <div class="offer-mini-item">
                  <strong>${escapeHtml(offerta.nome)}</strong>
                  <span>${escapeHtml(offerta.tipologia)} · ${escapeHtml(offerta.prezzo)} · Partner ${escapeHtml(offerta.percentualePartner)}</span>
                </div>
              `
            )
            .join("")}
        </div>

        <div class="linked-offers-block">
          <span class="eyebrow">Offerte sottoscritte</span>
          ${
            payload.offerteSottoscritte.length
              ? payload.offerteSottoscritte
                  .map(
                    (offerta) => `
                      <div class="offer-mini-item">
                        <strong>${escapeHtml(offerta.nome)}</strong>
                        <span>${escapeHtml(offerta.tipologia)} · ${escapeHtml(offerta.prezzo)}</span>
                      </div>
                    `
                  )
                  .join("")
              : `<span class="subtle">Nessuna sottoscrizione attiva</span>`
          }
        </div>
      </div>

      <div class="timeline-panel">
        <div class="section-head">
          <div>
            <span class="eyebrow">Timeline</span>
            <h3>Interazioni</h3>
          </div>
        </div>
        <div class="timeline">
          ${corrente.timeline
            .map(
              (evento) => `
                <article class="timeline-card">
                  <span class="eyebrow">${escapeHtml(evento.tipo)}</span>
                  <h3>${formattaData(evento.data)}</h3>
                  <p>${escapeHtml(evento.testo)}</p>
                </article>
              `
            )
            .join("")}
        </div>
      </div>
    </section>
  `;

  document.getElementById("copy-dettaglio")?.addEventListener("click", (event) => copiaTesto(corrente.messaggioSuggerito, event.currentTarget));
}

function statoRecordLabel(stato) {
  return {
    ready: "Pronto",
    duplicate: "Duplicato",
    needs_review: "Da revisionare",
    failed: "Errore",
    imported: "Importato",
    excluded: "Escluso",
    analyzed: "Analizzato",
    pending: "In attesa"
  }[stato] || stato;
}

function classeStatoRecord(stato) {
  return {
    ready: "tone-success",
    duplicate: "tone-warning",
    needs_review: "tone-rose",
    failed: "tone-rose",
    imported: "tone-success",
    excluded: "tone-muted",
    analyzed: "tone-accent",
    pending: "tone-muted"
  }[stato] || "tone-muted";
}

function aggiornaRecordAnteprima(recordId, patch) {
  statoApp.importazioneLinkedin.records = statoApp.importazioneLinkedin.records.map((record) =>
    record.id === recordId ? { ...record, ...patch } : record
  );
}

function recordAnteprimaFiltrati() {
  const filtro = statoApp.importazioneLinkedin.filtroFonte;
  if (filtro === "tutti") return statoApp.importazioneLinkedin.records;
  return statoApp.importazioneLinkedin.records.filter((record) => record.sourceKind === filtro);
}

async function salvaImpostazioniAiLinkedin(formData) {
  const payload = {
    provider: formData.get("provider"),
    modello: formData.get("modello"),
    endpoint: formData.get("endpoint"),
    temperatura: Number(formData.get("temperatura") || 0.2),
    maxToken: Number(formData.get("maxToken") || 600),
    limiteCrediti: Number(formData.get("limiteCrediti") || 120),
    creditiResidui: Number(formData.get("limiteCrediti") || 120),
    creditiConsumati: 0
  };
  const apiKey = formData.get("apiKey");
  if (apiKey) payload.apiKey = apiKey;
  const risposta = await api("/api/impostazioni/ai-provider", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  statoApp.impostazioniAi = risposta.impostazioni;
  mostraToast("Impostazioni AI salvate");
}

async function inviaArchivioLinkedin(file) {
  const formData = new FormData();
  formData.append("file", file);
  const risposta = await api("/api/importazioni/linkedin/upload", {
    method: "POST",
    body: formData,
    headers: {}
  });
  statoApp.importazioneLinkedin.job = risposta.job;
  statoApp.importazioneLinkedin.records = risposta.records;
  statoApp.importazioneLinkedin.riepilogo = risposta.riepilogo;
}

async function confermaImportazioneLinkedin() {
  if (!statoApp.importazioneLinkedin.job) {
    throw new Error("Nessuna importazione da confermare");
  }
  const risposta = await api(`/api/importazioni/linkedin/${statoApp.importazioneLinkedin.job.id}/conferma`, {
    method: "POST",
    body: JSON.stringify({
      records: statoApp.importazioneLinkedin.records
    })
  });
  statoApp.importazioneLinkedin.job = risposta.job;
  statoApp.contatti = risposta.contatti;
  statoApp.riepilogo = risposta.riepilogo;
  aggiornaMetaSidebar();
}

async function annullaImportazioneLinkedin() {
  if (!statoApp.importazioneLinkedin.job) return;
  const risposta = await api(`/api/importazioni/linkedin/${statoApp.importazioneLinkedin.job.id}/annulla`, {
    method: "POST",
    body: JSON.stringify({})
  });
  statoApp.importazioneLinkedin.job = risposta.job;
}

function renderStepImportazione(step) {
  return `
    <div class="processing-item processing-item-${escapeHtml(step.status)}">
      <span>${escapeHtml(step.label)}</span>
      <strong>${step.status === "done" ? "OK" : step.status === "active" ? "In corso" : "Attesa"}</strong>
    </div>
  `;
}

function renderRigaAnteprimaImport(record) {
  const contatto = record.normalizedData || {};
  const suggerimento = record.aiAnalysis || {};
  return `
    <tr>
      <td>
        <div class="contact-primary">
          <strong>${escapeHtml(contatto.fullName || "-")}</strong>
          <span>${escapeHtml(contatto.company || "-")}</span>
        </div>
      </td>
      <td>${escapeHtml(contatto.jobTitle || "-")}</td>
      <td>${escapeHtml(record.tipologiaContatto || "-")}</td>
      <td><span class="pill ${record.sourceKind === "connections" ? "tone-success" : record.sourceKind === "imported_contacts" ? "tone-warning" : "tone-muted"}">${escapeHtml(record.sourceLabel || "-")}</span></td>
      <td>${escapeHtml(String(record.qualityScore ?? "-"))}</td>
      <td><span class="pill ${classeStatoRecord(record.status)}">${escapeHtml(statoRecordLabel(record.status))}</span></td>
      <td><input class="table-input" data-import-pipeline="${record.id}" value="${escapeHtml(record.suggestedPipeline || "")}" /></td>
      <td>
        <select class="table-select" data-import-stage="${record.id}">
          ${statoApp.statiPipeline.map((stato) => `<option value="${escapeHtml(stato)}" ${record.suggestedStage === stato ? "selected" : ""}>${escapeHtml(stato)}</option>`).join("")}
        </select>
      </td>
      <td><input class="table-input" data-import-tag="${record.id}" value="${escapeHtml((record.tagSuggeriti || []).join(", "))}" /></td>
      <td>
        <select class="table-select" data-import-priority="${record.id}">
          ${["Alta", "Media", "Bassa"].map((livello) => `<option value="${livello}" ${record.priorita === livello ? "selected" : ""}>${livello}</option>`).join("")}
        </select>
      </td>
      <td>${escapeHtml(record.ultimaConversazione ? formattaData(record.ultimaConversazione) : "-")}</td>
      <td>${escapeHtml((suggerimento.contact_summary || "").slice(0, 120) || "-")}</td>
      <td>${escapeHtml(suggerimento.commercial_intent || "-")}</td>
      <td>${Math.round(Number(record.confidenceScore || 0) * 100)}%</td>
      <td><textarea class="table-textarea" data-import-note="${record.id}">${escapeHtml(record.note || "")}</textarea></td>
      <td><input type="checkbox" data-import-exclude="${record.id}" ${record.exclude ? "checked" : ""} /></td>
    </tr>
  `;
}

function bindAnteprimaImportazione() {
  document.querySelectorAll("[data-import-pipeline]").forEach((input) => {
    input.addEventListener("input", () => aggiornaRecordAnteprima(input.dataset.importPipeline, { suggestedPipeline: input.value }));
  });
  document.querySelectorAll("[data-import-stage]").forEach((select) => {
    select.addEventListener("change", () => aggiornaRecordAnteprima(select.dataset.importStage, { suggestedStage: select.value }));
  });
  document.querySelectorAll("[data-import-tag]").forEach((input) => {
    input.addEventListener("input", () =>
      aggiornaRecordAnteprima(input.dataset.importTag, {
        tagSuggeriti: input.value.split(",").map((tag) => tag.trim()).filter(Boolean)
      })
    );
  });
  document.querySelectorAll("[data-import-priority]").forEach((select) => {
    select.addEventListener("change", () => aggiornaRecordAnteprima(select.dataset.importPriority, { priorita: select.value }));
  });
  document.querySelectorAll("[data-import-note]").forEach((textarea) => {
    textarea.addEventListener("input", () => aggiornaRecordAnteprima(textarea.dataset.importNote, { note: textarea.value }));
  });
  document.querySelectorAll("[data-import-exclude]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => aggiornaRecordAnteprima(checkbox.dataset.importExclude, { exclude: checkbox.checked }));
  });
}

function renderOnboarding() {
  const job = statoApp.importazioneLinkedin.job;
  const records = recordAnteprimaFiltrati();
  const riepilogo = statoApp.importazioneLinkedin.riepilogo;
  const impostazioniAi = statoApp.impostazioniAi || {};
  const limiteMb = statoApp.limiteZipBytes ? Math.round(statoApp.limiteZipBytes / 1024 / 1024) : 30;
  areaPrincipale.innerHTML = `
    <section class="page-header">
      <div>
        <span class="eyebrow">CRM > Importa da LinkedIn</span>
        <h1>Importazione Archivio LinkedIn</h1>
        <p>Carica qui l'archivio ufficiale esportato da LinkedIn. Il sistema analizzerà contatti e conversazioni per organizzarli automaticamente nel CRM.</p>
      </div>
      <div class="header-actions">
        <a class="ghost-btn" href="/contatti" data-link>Vai ai contatti</a>
      </div>
    </section>

    <section class="upload-hero-grid">
      <article class="upload-card upload-primary-card">
        <span class="eyebrow">Upload</span>
        <h3>Carica archivio ZIP</h3>
        <div class="dropzone">
          <strong>Seleziona l'archivio .zip esportato da LinkedIn</strong>
          <p class="subtle">Limite attuale: ${limiteMb} MB. Il file viene validato, estratto in sicurezza e poi eliminato dalla cartella temporanea.</p>
          <input type="file" id="file-input" accept=".zip" />
        </div>
        <div class="actions-row form-actions">
          <button class="btn" id="importa-file">Avvia importazione</button>
          <button class="ghost-btn" id="annulla-import" ${!job ? "disabled" : ""}>Annulla job</button>
        </div>
        <p class="subtle" id="stato-upload">${job ? `Job ${escapeHtml(job.status)} - ${escapeHtml(job.originalFileName)}` : "Nessun file selezionato."}</p>
      </article>

      <article class="upload-card">
        <span class="eyebrow">Passaggi</span>
        <h3>Guida passo passo</h3>
        <div class="processing-list">
          <div class="processing-item">1. Apri LinkedIn e vai in <strong>Impostazioni e privacy</strong>.</div>
          <div class="processing-item">2. Apri <strong>Privacy dei dati</strong> e clicca <strong>Ottieni una copia dei tuoi dati</strong>.</div>
          <div class="processing-item">3. Richiedi l'archivio completo o almeno connessioni e messaggi.</div>
          <div class="processing-item">4. Quando LinkedIn invia il download, scarica il file <strong>.zip</strong> senza modificarlo.</div>
          <div class="processing-item">5. Carica il file qui: il sistema troverà automaticamente contatti e conversazioni utili.</div>
        </div>
      </article>

      <article class="upload-card">
        <span class="eyebrow">Provider AI</span>
        <h3>Configura analisi e classificazione</h3>
        <form id="form-ai" class="stack-form">
          <input type="text" name="provider" placeholder="Provider" value="${escapeHtml(impostazioniAi.provider || "openai-compatibile")}" />
          <input type="text" name="endpoint" placeholder="Endpoint API" value="${escapeHtml(impostazioniAi.endpoint || "https://api.openai.com/v1/chat/completions")}" />
          <input type="text" name="modello" placeholder="Modello" value="${escapeHtml(impostazioniAi.modello || "gpt-4.1-mini")}" />
          <div class="dual-field">
            <input type="number" step="0.1" min="0" max="2" name="temperatura" placeholder="Temperatura" value="${escapeHtml(String(impostazioniAi.temperatura ?? 0.2))}" />
            <input type="number" min="100" max="4000" name="maxToken" placeholder="Max token" value="${escapeHtml(String(impostazioniAi.maxToken ?? 600))}" />
          </div>
          <input type="number" min="10" max="5000" name="limiteCrediti" placeholder="Limite crediti AI" value="${escapeHtml(String(impostazioniAi.limiteCrediti ?? 120))}" />
          <input type="password" name="apiKey" placeholder="${impostazioniAi.chiaveConfigurata ? `Chiave salvata: ${escapeHtml(impostazioniAi.apiKeyMasked || "")}` : "API key"}" />
          <button class="ghost-btn" type="submit" id="salva-ai">Salva provider AI</button>
        </form>
        <div class="metric-strip metric-strip-compact">
          ${renderMetricCard("Crediti residui", impostazioniAi.creditiResidui ?? 120, "Contatore di sicurezza per le analisi AI")}
          ${renderMetricCard("Crediti consumati", impostazioniAi.creditiConsumati ?? 0, "Scalati durante parsing e classificazione")}
        </div>
      </article>
    </section>

    <section class="workspace-panel import-destination-panel">
      <div class="section-head">
        <div>
          <span class="eyebrow">Smistamento automatico</span>
          <h3>Dove vanno i dati dopo lo spacchettamento</h3>
        </div>
      </div>
      <div class="landing-destination-grid import-destination-grid">
        <div class="destination-card">
          <strong>Contatti</strong>
          <p>Connections.csv alimenta il CRM principale con record piu affidabili e gia puliti.</p>
        </div>
        <div class="destination-card">
          <strong>Pipeline</strong>
          <p>Ogni contatto riceve stato, stage e priorita in base a ruolo, messaggi e segnali raccolti.</p>
        </div>
        <div class="destination-card">
          <strong>Da revisionare</strong>
          <p>I record incerti o deboli, soprattutto da ImportedContacts.csv, restano in preview e non sporcano il CRM.</p>
        </div>
        <div class="destination-card">
          <strong>Suggerimenti AI e Analytics</strong>
          <p>Conversazioni, tag e classificazioni utili vengono riusati nelle sezioni operative della piattaforma.</p>
        </div>
      </div>
    </section>

    ${
      job
        ? `
          <section class="workspace-panel">
            <div class="section-head">
              <div>
                <span class="eyebrow">Stato importazione</span>
                <h3>Job ${escapeHtml(job.originalFileName)}</h3>
              </div>
              <span class="pill ${job.status === "completed" ? "tone-success" : job.status === "failed" ? "tone-rose" : "tone-accent"}">${escapeHtml(job.status)}</span>
            </div>
            <div class="processing-list processing-grid">
              ${(job.metadata?.stepStates || []).map(renderStepImportazione).join("")}
            </div>
            ${
              job.metadata?.avvisi?.length
                ? `<div class="info-banner">${job.metadata.avvisi.map((avviso) => `<p>${escapeHtml(avviso)}</p>`).join("")}</div>`
                : ""
            }
            <div class="metric-strip">
              ${renderMetricCard("File utili", job.metadata?.fileUtili?.length || 0, "File riconosciuti nell'archivio")}
              ${renderMetricCard("Contatti trovati", job.totalContactsFound || 0, "Record normalizzati")}
              ${renderMetricCard("Conversazioni", job.totalConversationsFound || 0, "Thread collegati ai contatti")}
              ${renderMetricCard("Duplicati", job.totalDuplicatesFound || 0, "Match con il CRM esistente")}
            </div>
          </section>
        `
        : ""
    }

    ${
      records.length
        ? `
          <section class="workspace-panel">
            <div class="section-head">
              <div>
                <span class="eyebrow">Anteprima importazione</span>
                <h3>Rivedi prima di scrivere nel CRM</h3>
              </div>
              <div class="actions-row">
                <button class="ghost-btn" id="escludi-duplicati">Escludi duplicati</button>
                <button class="btn" id="conferma-importazione">Conferma importazione</button>
              </div>
            </div>
            <div class="metric-strip">
              ${renderMetricCard("Nuovi", riepilogo?.nuovi || 0, "Contatti da creare")}
              ${renderMetricCard("Duplicati", riepilogo?.duplicati || 0, "Contatti esistenti da aggiornare")}
              ${renderMetricCard("Da revisionare", riepilogo?.daRevisionare || 0, "Confidence bassa o dati incompleti")}
              ${renderMetricCard("Esclusi auto", riepilogo?.esclusiAuto || 0, "Record deboli filtrati prima del CRM")}
            </div>
            <div class="preset-row import-source-row">
              <button class="preset-chip ${statoApp.importazioneLinkedin.filtroFonte === "tutti" ? "is-selected" : ""}" data-source-filter="tutti">Tutti (${statoApp.importazioneLinkedin.records.length})</button>
              <button class="preset-chip ${statoApp.importazioneLinkedin.filtroFonte === "connections" ? "is-selected" : ""}" data-source-filter="connections">Connections.csv (${riepilogo?.connections || 0})</button>
              <button class="preset-chip ${statoApp.importazioneLinkedin.filtroFonte === "imported_contacts" ? "is-selected" : ""}" data-source-filter="imported_contacts">ImportedContacts.csv (${riepilogo?.importedContacts || 0})</button>
            </div>
            <div class="table-shell preview-shell">
              <table class="data-table preview-table">
                <thead>
                  <tr>
                    <th>Contatto</th>
                    <th>Ruolo</th>
                    <th>Tipologia</th>
                    <th>Sorgente</th>
                    <th>Qualità</th>
                    <th>Esito</th>
                    <th>Pipeline</th>
                    <th>Stage</th>
                    <th>Tag</th>
                    <th>Priorità</th>
                    <th>Ultima conversazione</th>
                    <th>Sintesi AI</th>
                    <th>Intento</th>
                    <th>Confidence</th>
                    <th>Note</th>
                    <th>Escludi</th>
                  </tr>
                </thead>
                <tbody>
                  ${records.length ? records.map(renderRigaAnteprimaImport).join("") : `<tr><td colspan="16"><div class="empty-state"><strong>Nessun record in questo gruppo.</strong><p>Cambia filtro sorgente per continuare la revisione.</p></div></td></tr>`}
                </tbody>
              </table>
            </div>
          </section>
        `
        : ""
    }
  `;

  document.getElementById("file-input")?.addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    document.getElementById("stato-upload").textContent = file ? `${file.name} selezionato.` : "Nessun file selezionato.";
  });

  document.getElementById("importa-file")?.addEventListener("click", (event) =>
    conBottoneInCaricamento(event.currentTarget, "Analizzo archivio...", async () => {
      const file = document.getElementById("file-input").files?.[0];
      if (!file) {
        mostraToast("Seleziona un archivio ZIP");
        return;
      }
      await inviaArchivioLinkedin(file);
      aggiornaMetaSidebar();
      renderOnboarding();
      mostraToast("Anteprima importazione pronta");
    })
  );

  document.getElementById("annulla-import")?.addEventListener("click", (event) =>
    conBottoneInCaricamento(event.currentTarget, "Annullamento...", async () => {
      await annullaImportazioneLinkedin();
      renderOnboarding();
      mostraToast("Job annullato");
    })
  );

  document.getElementById("form-ai")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await conBottoneInCaricamento(document.getElementById("salva-ai"), "Salvo...", async () => {
      await salvaImpostazioniAiLinkedin(new FormData(event.currentTarget));
      renderOnboarding();
    });
  });

  document.getElementById("escludi-duplicati")?.addEventListener("click", () => {
    statoApp.importazioneLinkedin.records = statoApp.importazioneLinkedin.records.map((record) =>
      record.status === "duplicate" ? { ...record, exclude: true } : record
    );
    renderOnboarding();
  });

  document.getElementById("conferma-importazione")?.addEventListener("click", (event) =>
    conBottoneInCaricamento(event.currentTarget, "Importo nel CRM...", async () => {
      await confermaImportazioneLinkedin();
      renderOnboarding();
      mostraToast("Importazione completata");
    })
  );

  document.querySelectorAll("[data-source-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      statoApp.importazioneLinkedin.filtroFonte = button.dataset.sourceFilter;
      renderOnboarding();
    });
  });

  bindAnteprimaImportazione();
}

function renderLanding() {
  impostaLayout("public");
  areaPrincipale.innerHTML = `
    <section class="landing-shell">
      <article class="landing-hero">
        <div class="landing-copy">
          <span class="eyebrow">LinkedIn archive to CRM</span>
          <h1>Carichi lo ZIP ufficiale di LinkedIn, Aito Business lo organizza nel tuo CRM.</h1>
          <p>La piattaforma valida l'archivio, legge connessioni e conversazioni, deduplica i contatti e li distribuisce in Contatti, Pipeline, Suggerimenti AI e Analytics.</p>
          <div class="hero-actions landing-actions">
            <a class="btn" href="/registrati" data-link>Crea il tuo account</a>
            <a class="ghost-btn" href="/accesso" data-link>Accedi</a>
          </div>
          <div class="landing-mini-grid">
            <div class="landing-mini-card">
              <span class="eyebrow">1. Upload ZIP</span>
              <strong>Archivio LinkedIn ufficiale</strong>
              <p>Caricamento web, validazione del file e apertura sicura.</p>
            </div>
            <div class="landing-mini-card">
              <span class="eyebrow">2. Parsing</span>
              <strong>Contatti e messaggi</strong>
              <p>Il sistema riconosce automaticamente Connections.csv, ImportedContacts.csv e messages.csv.</p>
            </div>
            <div class="landing-mini-card">
              <span class="eyebrow">3. Smistamento</span>
              <strong>CRM coerente</strong>
              <p>I record finiscono nelle sezioni corrette con deduplica, preview e conferma finale.</p>
            </div>
          </div>
        </div>
        <div class="landing-panel">
          <span class="eyebrow">Accessi</span>
          <h3>Accesso semplice per utenti e amministrazione</h3>
          <div class="landing-action-list">
            <a class="landing-link-card" href="/registrati" data-link>
              <strong>Registrazione utente</strong>
              <span>Crea il workspace personale e inizia con l'importazione LinkedIn.</span>
            </a>
            <a class="landing-link-card" href="/accesso" data-link>
              <strong>Login piattaforma</strong>
              <span>Accedi al tuo CRM, alle pipeline e alla sezione import.</span>
            </a>
            <a class="landing-link-card" href="/admin/login" data-link>
              <strong>Login amministrazione</strong>
              <span>Area separata per vedere tutti gli utenti registrati e il riepilogo della piattaforma.</span>
            </a>
          </div>
        </div>
      </article>

      <section class="landing-flow-grid">
        <article class="panel-card">
          <span class="eyebrow">Dove vanno i dati</span>
          <h3>Smistamento automatico dopo lo ZIP</h3>
          <div class="landing-destination-grid">
            <div class="destination-card">
              <strong>Contatti</strong>
              <p>Profili deduplicati, arricchiti con ruolo, azienda, tipologia e priorita.</p>
            </div>
            <div class="destination-card">
              <strong>Pipeline</strong>
              <p>Ogni contatto riceve stage e stato coerenti in base a segnali e conversazioni.</p>
            </div>
            <div class="destination-card">
              <strong>Suggerimenti AI</strong>
              <p>Messaggi consigliati, insight e prossima azione per ogni record utile.</p>
            </div>
            <div class="destination-card">
              <strong>Analytics</strong>
              <p>I dati importati alimentano grafici, distribuzioni e tracking operativo.</p>
            </div>
          </div>
        </article>
      </section>
    </section>
  `;
}

function renderAuth(tipo = "login") {
  const configurazioni = {
    login: {
      modalita: "auth",
      eyebrow: "Accesso piattaforma",
      titolo: "Accedi al tuo workspace",
      descrizione: "Entra nella piattaforma per usare CRM, pipeline, offerte e importazione archivio LinkedIn.",
      endpoint: "/api/auth/login",
      submitId: "auth-submit",
      submitLabel: "Accedi",
      submitBusy: "Accesso...",
      campi: `
        <input type="email" name="email" placeholder="Email" required />
        <input type="password" name="password" placeholder="Password" required />
      `,
      payload: (formData) => ({
        email: formData.get("email"),
        password: formData.get("password")
      }),
      destinazione: "/dashboard",
      linkSecondario: `<p class="auth-helper">Non hai ancora un account? <a href="/registrati" data-link>Registrati</a></p>`
    },
    register: {
      modalita: "auth",
      eyebrow: "Registrazione utente",
      titolo: "Crea il tuo account",
      descrizione: "Apri un nuovo workspace personale. Dopo la registrazione puoi caricare subito il file ZIP di LinkedIn.",
      endpoint: "/api/auth/register",
      submitId: "auth-submit",
      submitLabel: "Registrati",
      submitBusy: "Creo account...",
      campi: `
        <input type="text" name="nome" placeholder="Nome e cognome" required />
        <input type="email" name="email" placeholder="Email" required />
        <input type="password" name="password" placeholder="Password" required />
      `,
      payload: (formData) => ({
        nome: formData.get("nome"),
        email: formData.get("email"),
        password: formData.get("password")
      }),
      destinazione: "/dashboard",
      linkSecondario: `<p class="auth-helper">Hai gia un account? <a href="/accesso" data-link>Accedi</a></p>`
    },
    admin: {
      modalita: "admin",
      eyebrow: "Accesso amministrazione",
      titolo: "Area amministrativa",
      descrizione: "Login separato per vedere utenti registrati, contatti salvati e stato generale della piattaforma.",
      endpoint: "/api/auth/admin-login",
      submitId: "auth-submit",
      submitLabel: "Accedi come admin",
      submitBusy: "Verifico accesso...",
      campi: `
        <input type="email" name="email" placeholder="Email amministratore" required />
        <input type="password" name="password" placeholder="Password" required />
      `,
      payload: (formData) => ({
        email: formData.get("email"),
        password: formData.get("password")
      }),
      destinazione: "/admin",
      linkSecondario: `<p class="auth-helper">Accesso utente standard? <a href="/accesso" data-link>Vai al login piattaforma</a></p>`
    }
  };

  const config = configurazioni[tipo] || configurazioni.login;
  impostaLayout(config.modalita);
  areaPrincipale.innerHTML = `
    <section class="auth-shell">
      <article class="auth-main-card">
        <span class="eyebrow">${escapeHtml(config.eyebrow)}</span>
        <h1>${escapeHtml(config.titolo)}</h1>
        <p>${escapeHtml(config.descrizione)}</p>
        <form id="auth-form" class="stack-form auth-form">
          ${config.campi}
          <button class="btn" id="${config.submitId}" type="submit">${escapeHtml(config.submitLabel)}</button>
        </form>
        ${config.linkSecondario}
      </article>
      <article class="auth-side-card">
        <span class="eyebrow">Flusso operativo</span>
        <h3>Dopo il login il sistema fa questo lavoro</h3>
        <div class="auth-benefit-list">
          <div class="auth-benefit-item">
            <strong>Upload ZIP LinkedIn</strong>
            <p>Archivio validato e aperto in sicurezza, senza scraping e senza desktop app.</p>
          </div>
          <div class="auth-benefit-item">
            <strong>Preview prima del salvataggio</strong>
            <p>Controlli nuovi record, duplicati, revisioni e stage suggeriti prima di scrivere nel CRM.</p>
          </div>
          <div class="auth-benefit-item">
            <strong>Smistamento automatico</strong>
            <p>Contatti, pipeline, suggerimenti AI e analytics restano coerenti e sincronizzati.</p>
          </div>
        </div>
        <div class="info-banner">
          <p>Link amministrazione: <strong>/admin/login</strong></p>
        </div>
      </article>
    </section>
  `;

  document.getElementById("auth-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await conBottoneInCaricamento(document.getElementById(config.submitId), config.submitBusy, async () => {
      const formData = new FormData(event.currentTarget);
      await api(config.endpoint, {
        method: "POST",
        body: JSON.stringify(config.payload(formData))
      });
      await caricaDati();
      navigate(config.destinazione);
    });
  });
}

async function renderAdminDashboard() {
  impostaLayout("admin");
  await caricaAdmin();
  const riepilogo = statoApp.admin.riepilogo || {};
  areaPrincipale.innerHTML = `
    <section class="admin-shell">
      <section class="page-header admin-header">
        <div>
          <span class="eyebrow">Amministrazione</span>
          <h1>Utenti registrati sulla piattaforma</h1>
          <p>Vista centralizzata per controllare account creati, volume contatti e utilizzo delle importazioni LinkedIn.</p>
        </div>
        <div class="header-actions">
          <a class="ghost-btn" href="/dashboard" data-link>Apri piattaforma</a>
          <button class="btn" id="admin-logout">Logout</button>
        </div>
      </section>

      <section class="metrics-grid admin-metrics-grid">
        ${renderMetricCard("Utenti", riepilogo.totaleUtenti || 0, "Account registrati", "metric-ink")}
        ${renderMetricCard("Admin", riepilogo.totaleAdmin || 0, "Accessi amministrativi", "metric-accent")}
        ${renderMetricCard("Contatti", riepilogo.totaleContatti || 0, "Record CRM salvati", "metric-gold")}
        ${renderMetricCard("Importazioni", riepilogo.totaleImportazioni || 0, "Job LinkedIn registrati", "metric-muted")}
      </section>

      <section class="panel-card admin-users-card">
        <div class="section-head">
          <div>
            <span class="eyebrow">Directory utenti</span>
            <h3>Tutti gli account</h3>
          </div>
          <span class="subtle">${statoApp.admin.utenti.length} account visibili</span>
        </div>
        <div class="table-card">
          <table class="contacts-table">
            <thead>
              <tr>
                <th>Nome</th>
                <th>Email</th>
                <th>Ruolo</th>
                <th>Contatti</th>
                <th>Importazioni</th>
                <th>Creato il</th>
              </tr>
            </thead>
            <tbody>
              ${
                statoApp.admin.utenti.length
                  ? statoApp.admin.utenti
                      .map(
                        (utente) => `
                          <tr>
                            <td><strong>${escapeHtml(utente.nome)}</strong></td>
                            <td>${escapeHtml(utente.email)}</td>
                            <td><span class="pill lead-type-pill">${escapeHtml(utente.ruolo)}</span></td>
                            <td>${escapeHtml(String(utente.totale_contatti || 0))}</td>
                            <td>${escapeHtml(String(utente.totale_importazioni || 0))}</td>
                            <td>${escapeHtml(formattaData(utente.created_at))}</td>
                          </tr>
                        `
                      )
                      .join("")
                  : `<tr><td colspan="6"><div class="empty-state"><strong>Nessun utente trovato.</strong><p>La piattaforma mostera qui tutte le nuove registrazioni.</p></div></td></tr>`
              }
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;

  document.getElementById("admin-logout")?.addEventListener("click", () => eseguiLogout("/admin/login"));
}

function renderPipeline() {
  areaPrincipale.innerHTML = `
    <section class="page-header">
      <div>
        <span class="eyebrow">Pipeline</span>
        <h1>Kanban commerciale</h1>
        <p>Ogni colonna rappresenta uno stato. Trascina le card per aggiornare lo stato nel database.</p>
      </div>
    </section>

    <section class="kanban-board">
      ${statoApp.statiPipeline
        .map((stato) => {
          const contatti = statoApp.contatti.filter((contatto) => contatto.stato === stato);
          return `
            <div class="kanban-column" data-drop-stato="${escapeHtml(stato)}">
              <div class="kanban-head">
                <div>
                  <span class="eyebrow">${escapeHtml(stato)}</span>
                  <strong>${contatti.length}</strong>
                </div>
              </div>
              <div class="kanban-list">
                ${contatti
                  .map(
                    (contatto) => `
                      <article class="kanban-card" draggable="true" data-drag-id="${contatto.id}">
                        <div class="kanban-card-top">
                          <span class="avatar">${iniziali(contatto.nome)}</span>
                          <div>
                            <strong>${escapeHtml(contatto.nome)}</strong>
                            <p>${escapeHtml(contatto.ruolo)}</p>
                          </div>
                        </div>
                        <div class="kanban-card-meta">
                          <span class="pill priority-pill priority-${contatto.livelloPriorita.toLowerCase()}">${escapeHtml(contatto.livelloPriorita)}</span>
                          <span class="pill lead-type-pill">${escapeHtml(contatto.tipologiaContatto)}</span>
                        </div>
                        <div class="actions-row">
                          <button class="small-btn" data-dettaglio="${contatto.id}">Open</button>
                          <button class="small-btn" data-copy="${contatto.id}">Copy</button>
                        </div>
                      </article>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `;
        })
        .join("")}
    </section>
  `;

  bindDettaglioContatto();
  document.querySelectorAll("[data-copy]").forEach((bottone) => {
    bottone.addEventListener("click", () => {
      const contatto = trovaContatto(bottone.dataset.copy);
      copiaTesto(contatto.messaggioSuggerito, bottone);
    });
  });

  document.querySelectorAll("[data-drag-id]").forEach((card) => {
    card.addEventListener("dragstart", () => {
      idContattoDrag = card.dataset.dragId;
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => {
      idContattoDrag = null;
      card.classList.remove("is-dragging");
    });
  });

  document.querySelectorAll("[data-drop-stato]").forEach((colonna) => {
    colonna.addEventListener("dragover", (event) => {
      event.preventDefault();
      colonna.classList.add("is-drop-target");
    });
    colonna.addEventListener("dragleave", () => {
      colonna.classList.remove("is-drop-target");
    });
    colonna.addEventListener("drop", async (event) => {
      event.preventDefault();
      colonna.classList.remove("is-drop-target");
      if (!idContattoDrag) return;
      const nuovoStato = colonna.dataset.dropStato;
      const corrente = trovaContatto(idContattoDrag);
      if (!corrente || corrente.stato === nuovoStato) return;
      await aggiornaContatto(
        idContattoDrag,
        {
          stato: nuovoStato,
          ultimoContatto: oggi(),
          aggiungiEventoTimeline: {
            tipo: "stato",
            testo: `Spostato in ${nuovoStato}`
          }
        },
        `Contatto spostato in ${nuovoStato}`
      );
      renderRoute(trovaContatto(idContattoDrag));
    });
  });
}

function renderOfferte() {
  areaPrincipale.innerHTML = `
    <section class="page-header">
      <div>
        <span class="eyebrow">Offerte</span>
        <h1>Catalogo offerte</h1>
        <p>Offerte dell'azienda e dei partner, collegate automaticamente ai contatti in base a tipologia, settore e bisogni stimati.</p>
      </div>
    </section>

    <section class="offers-grid">
      ${statoApp.offerte
        .map((offerta) => {
          const collegati = statoApp.contatti.filter((contatto) => (contatto.offerteProposteIds || []).includes(offerta.id));
          return `
            <article class="offer-card">
              <span class="eyebrow">${escapeHtml(offerta.tipologia)}</span>
              <h3>${escapeHtml(offerta.nome)}</h3>
              <p>${escapeHtml(offerta.descrizione)}</p>
              <div class="offer-meta">
                <div><span>Prezzo</span><strong>${escapeHtml(offerta.prezzo)}</strong></div>
                <div><span>Partner %</span><strong>${escapeHtml(offerta.percentualePartner)}</strong></div>
              </div>
              <div class="offer-linked">
                <span class="eyebrow">Contatti collegati</span>
                ${
                  collegati.length
                    ? collegati
                        .map((contatto) => `<button class="small-btn" data-dettaglio="${contatto.id}">${escapeHtml(contatto.nome)}</button>`)
                        .join("")
                    : `<span class="subtle">Nessun contatto collegato</span>`
                }
              </div>
            </article>
          `;
        })
        .join("")}
    </section>
  `;

  bindDettaglioContatto();
}

function renderAnalytics() {
  const tutti = statoApp.contatti;
  const subsetRuolo = [
    { titolo: "Ruolo · Tutti i contatti", lista: tutti },
    { titolo: "Ruolo · Contatti con call", lista: contattiConCall(tutti) },
    { titolo: "Ruolo · Abbonati", lista: tutti.filter((contatto) => contatto.stato === "Abbonato") },
    { titolo: "Ruolo · KO", lista: tutti.filter((contatto) => contatto.stato === "KO") },
    { titolo: "Ruolo · Disdettati", lista: tutti.filter((contatto) => contatto.stato === "Disdettato") }
  ];

  const subsetTipologia = [
    { titolo: "Tipologia · Tutti i contatti", lista: tutti },
    { titolo: "Tipologia · Contatti con call", lista: contattiConCall(tutti) },
    { titolo: "Tipologia · Abbonati", lista: tutti.filter((contatto) => contatto.stato === "Abbonato") },
    { titolo: "Tipologia · KO", lista: tutti.filter((contatto) => contatto.stato === "KO") },
    { titolo: "Tipologia · Disdettati", lista: tutti.filter((contatto) => contatto.stato === "Disdettato") }
  ];

  const contattiPartnerPerOfferta = (idOfferta) =>
    contattiAssociatiAOfferta(idOfferta).filter((contatto) => contatto.tipologiaContatto === "Potenziale Partner");
  const contattiClientiPerOfferta = (idOfferta) =>
    contattiAssociatiAOfferta(idOfferta).filter((contatto) => contatto.tipologiaContatto === "Potenziale Cliente");
  const contattiConOffertePartner = statoApp.contatti.filter((contatto) =>
    (contatto.offerteProposteIds || []).some((id) => trovaOfferta(id)?.tipologia === "partner")
  );

  areaPrincipale.innerHTML = `
    <section class="page-header">
      <div>
        <span class="eyebrow">Analytics</span>
        <h1>Distribuzioni e andamento CRM</h1>
        <p>Grafici costruiti sui dati reali del CRM: ruoli, tipologie, stati di pipeline e breakdown per offerta.</p>
      </div>
    </section>

    <section class="metrics-grid">
      ${renderMetricCard("Grafici ruolo", subsetRuolo.length, "Distribuzioni a torta per ruolo", "metric-ink")}
      ${renderMetricCard("Grafici tipologia", subsetTipologia.length, "Distribuzioni a torta per tipologia", "metric-accent")}
      ${renderMetricCard("Bar chart globali", 4, "Stati su segmenti principali", "metric-gold")}
      ${renderMetricCard("Offerte analizzate", statoApp.offerte.length, "Breakdown per singola offerta", "metric-muted")}
    </section>

    <section class="analytics-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Ruolo</span>
          <h3>Distribuzioni a torta</h3>
        </div>
      </div>
      <div class="analytics-grid">
        ${subsetRuolo.map((blocco) => renderCardTorta(blocco.titolo, distribuzioneFrequenza(blocco.lista, (contatto) => contatto.ruolo))).join("")}
      </div>
    </section>

    <section class="analytics-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Tipologia</span>
          <h3>Distribuzioni a torta</h3>
        </div>
      </div>
      <div class="analytics-grid">
        ${subsetTipologia
          .map((blocco) => renderCardTorta(blocco.titolo, distribuzioneFrequenza(blocco.lista, (contatto) => contatto.tipologiaContatto)))
          .join("")}
      </div>
    </section>

    <section class="analytics-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Stati pipeline</span>
          <h3>Grafici a barre</h3>
        </div>
      </div>
      <div class="analytics-grid">
        ${renderCardBarre("Stati · Generale", distribuzioneStati(tutti))}
        ${renderCardBarre("Stati · Contatti con offerte partner", distribuzioneStati(contattiConOffertePartner))}
        ${renderCardBarre(
          "Stati · Potenziali partner",
          distribuzioneStati(tutti.filter((contatto) => contatto.tipologiaContatto === "Potenziale Partner"))
        )}
        ${renderCardBarre(
          "Stati · Potenziali clienti",
          distribuzioneStati(tutti.filter((contatto) => contatto.tipologiaContatto === "Potenziale Cliente"))
        )}
      </div>
    </section>

    <section class="analytics-section">
      <div class="section-head">
        <div>
          <span class="eyebrow">Analytics per offerta</span>
          <h3>Breakdown dettagliato</h3>
        </div>
      </div>
      <div class="offer-analytics-stack">
        ${statoApp.offerte
          .map((offerta) => {
            const associati = contattiAssociatiAOfferta(offerta.id);
            const partner = contattiPartnerPerOfferta(offerta.id);
            const clienti = contattiClientiPerOfferta(offerta.id);
            return `
              <section class="offer-analytics-card">
                <div class="section-head">
                  <div>
                    <span class="eyebrow">${escapeHtml(offerta.tipologia)}</span>
                    <h3>${escapeHtml(offerta.nome)}</h3>
                  </div>
                  <strong>${associati.length} contatti</strong>
                </div>
                <div class="analytics-grid">
                  ${renderCardTorta(`Ruolo · ${offerta.nome}`, distribuzioneFrequenza(associati, (contatto) => contatto.ruolo))}
                  ${renderCardTorta(`Tipologia · ${offerta.nome}`, distribuzioneFrequenza(associati, (contatto) => contatto.tipologiaContatto))}
                  ${renderCardBarre(`Stati · ${offerta.nome} · Generale`, distribuzioneStati(associati))}
                  ${renderCardBarre(`Stati · ${offerta.nome} · Potenziali partner`, distribuzioneStati(partner))}
                  ${renderCardBarre(`Stati · ${offerta.nome} · Potenziali clienti`, distribuzioneStati(clienti))}
                </div>
              </section>
            `;
          })
          .join("")}
      </div>
    </section>
  `;
}

async function renderSuggerimentiAi() {
  const payload = await api("/api/suggerimenti-ai");
  areaPrincipale.innerHTML = `
    <section class="page-header">
      <div>
        <span class="eyebrow">Suggerimenti AI</span>
        <h1>Prossime azioni consigliate</h1>
        <p>Messaggi pronti e suggerimenti ordinati per punteggio e stato della pipeline.</p>
      </div>
    </section>

    <section class="suggestion-grid">
      ${payload.suggerimenti
        .map(
          (item) => `
            <article class="suggestion-card">
              <div class="suggestion-head">
                <div class="contact-cell">
                  <span class="avatar">${iniziali(item.nome)}</span>
                  <div class="contact-primary">
                    <strong>${escapeHtml(item.nome)}</strong>
                    <span>${escapeHtml(item.azienda)}</span>
                  </div>
                </div>
                <div class="score-block">
                  <strong>${item.suggerimento.punteggio}</strong>
                  <span>AI score</span>
                </div>
              </div>
              <span class="pill tone-${slugStato(item.suggerimento.statoLead)}">${escapeHtml(item.suggerimento.statoLead)}</span>
              <h3>${escapeHtml(item.suggerimento.prossimaAzione)}</h3>
              <p>${escapeHtml(item.suggerimento.insight)}</p>
              <div class="message-surface">${escapeHtml(item.suggerimento.messaggioSuggerito)}</div>
              <div class="actions-row">
                <button class="small-btn" data-dettaglio="${item.id}">Open</button>
                <button class="small-btn" data-copy="${item.id}">Copy</button>
                <button class="small-btn" data-ai="${item.id}">Refresh AI</button>
              </div>
            </article>
          `
        )
        .join("")}
    </section>
  `;

  bindDettaglioContatto();
  document.querySelectorAll("[data-copy]").forEach((bottone) => {
    bottone.addEventListener("click", () => {
      const contatto = trovaContatto(bottone.dataset.copy);
      copiaTesto(contatto.messaggioSuggerito, bottone);
    });
  });
  document.querySelectorAll("[data-ai]").forEach((bottone) => {
    bottone.addEventListener("click", (event) =>
      conBottoneInCaricamento(event.currentTarget, "Aggiorno...", () => generaSuggerimentoAi(bottone.dataset.ai))
    );
  });
}

function bindDettaglioContatto() {
  document.querySelectorAll("[data-dettaglio]").forEach((bottone) => {
    bottone.addEventListener("click", () => navigate(`/contatti/${bottone.dataset.dettaglio}`));
  });
}

function navigate(pathname) {
  window.history.pushState({}, "", pathname);
  renderRoute();
}

function bindGlobalNavigation() {
  document.querySelectorAll("[data-link]").forEach((link) => {
    link.addEventListener("click", (event) => {
      const href = link.getAttribute("href");
      if (!href.startsWith("/")) return;
      event.preventDefault();
      navigate(href);
    });
  });
}

async function renderRoute(contattoPreferito = null) {
  const pathname = window.location.pathname;
  impostaMenuAttivo();
  aggiornaMetaSidebar();

  if (!statoApp.sessione.autenticato) {
    pannelloAi.innerHTML = "";
    if (pathname === "/") {
      renderLanding();
      bindGlobalNavigation();
      return;
    }
    if (pathname === "/registrati") {
      renderAuth("register");
      bindGlobalNavigation();
      return;
    }
    if (pathname === "/admin/login") {
      renderAuth("admin");
      bindGlobalNavigation();
      return;
    }
    if (pathname === "/accesso") {
      renderAuth("login");
      bindGlobalNavigation();
      return;
    }
    navigate(pathname.startsWith("/admin") ? "/admin/login" : "/accesso");
    return;
  }

  if (pathname === "/admin/login") {
    if (utenteAdmin()) {
      pannelloAi.innerHTML = "";
      await renderAdminDashboard();
    } else {
      pannelloAi.innerHTML = "";
      renderAuth("admin");
    }
    bindGlobalNavigation();
    return;
  }

  if (pathname === "/admin") {
    if (!utenteAdmin()) {
      navigate("/dashboard");
      return;
    }
    pannelloAi.innerHTML = "";
    await renderAdminDashboard();
    bindGlobalNavigation();
    return;
  }

  if (pathname === "/accesso" || pathname === "/registrati") {
    navigate("/dashboard");
    return;
  }

  if (pathname === "/") {
    navigate("/dashboard");
    return;
  }

  impostaLayout("workspace");

  if (!utenteAdmin() && pathname.startsWith("/admin")) {
    navigate("/dashboard");
    return;
  }

  if (pathname === "/dashboard") {
    renderDashboard();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindGlobalNavigation();
    return;
  }

  if (pathname === "/contatti") {
    renderContatti();
    renderPannelloAi(contattoPreferito || contattiFiltrati()[0] || statoApp.contatti[0]);
    bindGlobalNavigation();
    return;
  }

  if (pathname === "/pipeline") {
    renderPipeline();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindGlobalNavigation();
    return;
  }

  if (pathname === "/offerte") {
    renderOfferte();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindGlobalNavigation();
    return;
  }

  if (pathname === "/analytics") {
    renderAnalytics();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindGlobalNavigation();
    return;
  }

  if (pathname === "/onboarding" || pathname === "/importa-linkedin") {
    renderOnboarding();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindGlobalNavigation();
    return;
  }

  if (pathname === "/suggerimenti-ai") {
    await renderSuggerimentiAi();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindGlobalNavigation();
    return;
  }

  const matchDettaglio = pathname.match(/^\/contatti\/([^/]+)$/);
  if (matchDettaglio) {
    const contatto = trovaContatto(matchDettaglio[1]);
    await renderDettaglioContatto(contattoPreferito || contatto);
    renderPannelloAi(contattoPreferito || contatto);
    bindGlobalNavigation();
    return;
  }

  navigate("/dashboard");
}

window.addEventListener("popstate", renderRoute);

caricaDati()
  .then(renderRoute)
  .catch((errore) => {
    areaPrincipale.innerHTML = `<section class="panel-card"><h1>Errore applicazione</h1><p>${escapeHtml(errore.message)}</p></section>`;
  });
