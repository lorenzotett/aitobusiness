/* ─────────────── STATO GLOBALE ─────────────── */
const statoApp = {
  contatti: [],
  riepilogo: null,
  promptAi: {},
  statiPipeline: [],
  offerte: [],
  filtri: {
    query: "",
    stato: "",
    localita: "",
    livelloPriorita: "",
    tipologiaContatto: ""
  }
};

const areaPrincipale = document.getElementById("main-content");
const pannelloAi     = document.getElementById("assistant-panel");
let debounceRicerca  = null;
let idContattoDrag   = null;

const COLORI_GRAFICI = [
  "#0d7a6b","#b77118","#a1543e","#445b53",
  "#49af98","#d3a458","#7f8b85","#0a3d35"
];

/* ─────────────── UTILS ─────────────── */
function escapeHtml(v = "") {
  return String(v)
    .replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;")
    .replaceAll('"',"&quot;").replaceAll("'","&#039;");
}

function formattaData(v) {
  if (!v) return "-";
  return new Intl.DateTimeFormat("it-IT", { day:"2-digit", month:"short", year:"numeric" })
    .format(new Date(v));
}

function oggi() { return new Date().toISOString().slice(0,10); }

function iniziali(nome = "") {
  return nome.split(" ").filter(Boolean).slice(0,2)
    .map(p => p[0]?.toUpperCase() || "").join("");
}

function slugStato(stato = "") {
  return stato.toLowerCase().replaceAll(" ","-");
}

function mostraToast(msg) {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

function setBottoneCaricamento(btn, attivo, etichetta) {
  if (!btn) return;
  if (attivo) {
    btn.dataset.orig = btn.textContent;
    btn.disabled = true;
    btn.classList.add("is-busy");
    btn.textContent = etichetta || "Attendo...";
  } else {
    btn.disabled = false;
    btn.classList.remove("is-busy");
    if (btn.dataset.orig) { btn.textContent = btn.dataset.orig; delete btn.dataset.orig; }
  }
}

async function conBottone(btn, label, task) {
  try {
    setBottoneCaricamento(btn, true, label);
    return await task();
  } catch (err) {
    mostraToast(err.message || "Errore imprevisto");
    throw err;
  } finally {
    setBottoneCaricamento(btn, false);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.errore || "Richiesta fallita");
  return data;
}

function trovaContatto(id)  { return statoApp.contatti.find(c => c.id === id); }
function trovaOfferta(id)   { return statoApp.offerte.find(o => o.id === id); }
function offerteProposte(c) { return (c.offerteProposteIds || []).map(trovaOfferta).filter(Boolean); }

function contattiFiltrati() {
  return statoApp.contatti.filter(c => {
    const src = [c.nome, c.ruolo, c.azienda, c.localita, c.tipologiaContatto].join(" ").toLowerCase();
    const q  = !statoApp.filtri.query || src.includes(statoApp.filtri.query.toLowerCase());
    const s  = !statoApp.filtri.stato || c.stato === statoApp.filtri.stato;
    const l  = !statoApp.filtri.localita || c.localita.toLowerCase().includes(statoApp.filtri.localita.toLowerCase());
    const p  = !statoApp.filtri.livelloPriorita || c.livelloPriorita === statoApp.filtri.livelloPriorita;
    const t  = !statoApp.filtri.tipologiaContatto || c.tipologiaContatto === statoApp.filtri.tipologiaContatto;
    return q && s && l && p && t;
  });
}

/* ─────────────── SIDEBAR (mobile) ─────────────── */
function initMobileUI() {
  const sidebar  = document.getElementById("sidebar");
  const overlay  = document.getElementById("sidebar-overlay");
  const btnOpen  = document.getElementById("sidebar-toggle");
  const btnClose = document.getElementById("sidebar-close");

  function aprire() {
    sidebar.classList.add("is-open");
    overlay.classList.add("is-visible");
    document.body.style.overflow = "hidden";
  }
  function chiudere() {
    sidebar.classList.remove("is-open");
    overlay.classList.remove("is-visible");
    document.body.style.overflow = "";
  }

  btnOpen?.addEventListener("click", aprire);
  btnClose?.addEventListener("click", chiudere);
  overlay?.addEventListener("click", chiudere);
}

/* ─────────────── META SIDEBAR ─────────────── */
function aggiornaMetaSidebar() {
  const focus = [...statoApp.contatti].sort((a,b) => b.punteggioLead - a.punteggioLead)[0];

  const set = (sel, val) => {
    document.querySelectorAll(`[data-nav-badge="${sel}"]`).forEach(el => el.textContent = val);
  };
  set("dashboard",  statoApp.contatti.length);
  set("contacts",   statoApp.contatti.length);
  set("pipeline",   statoApp.statiPipeline.length);
  set("offers",     statoApp.offerte.length);
  set("analytics",  "Live");
  set("suggestions", statoApp.contatti.filter(c => c.livelloPriorita === "Alta").length);

  const sfEl = document.getElementById("sidebar-focus");
  const ssEl = document.getElementById("sidebar-summary");
  if (sfEl) sfEl.textContent = focus ? `Priorità alta: ${focus.nome} – ${focus.azienda}.` : "Costruisci la pipeline.";
  if (ssEl) ssEl.textContent =
    `${statoApp.contatti.filter(c => c.stato === "Da contattare").length} da contattare, ` +
    `${statoApp.contatti.filter(c => c.stato === "Abbonato").length} abbonati, ` +
    `${statoApp.contatti.filter(c => c.tipologiaContatto === "Potenziale Partner").length} partner potenziali.`;

  const tb = document.getElementById("topbar-badge");
  if (tb) tb.textContent = focus ? `${focus.nome}` : "";
}

/* ─────────────── MENU ATTIVO ─────────────── */
function impostaMenuAttivo() {
  const path = window.location.pathname;
  document.querySelectorAll("[data-nav]").forEach(el => {
    const href = el.getAttribute("href");
    const isDetail = href === "/contatti" && path.startsWith("/contatti/");
    el.classList.toggle("active", path === href || isDetail);
  });
  // chiudi sidebar su mobile dopo navigazione
  if (window.innerWidth < 768) {
    document.getElementById("sidebar")?.classList.remove("is-open");
    document.getElementById("sidebar-overlay")?.classList.remove("is-visible");
    document.body.style.overflow = "";
  }
}

/* ─────────────── CARICAMENTO DATI ─────────────── */
async function caricaDati() {
  const [pContatti, pPrompt, pMeta] = await Promise.all([
    api("/api/contatti"),
    api("/api/prompt-ai"),
    api("/api/metadati")
  ]);
  statoApp.contatti      = pContatti.contatti;
  statoApp.riepilogo     = pContatti.riepilogo;
  statoApp.promptAi      = pPrompt.promptAi;
  statoApp.statiPipeline = pMeta.statiPipeline;
  statoApp.offerte       = pMeta.offerte;
  aggiornaMetaSidebar();
}

async function aggiornaContatto(id, payload, msg) {
  const res = await api(`/api/contatti/${id}`, { method:"PATCH", body: JSON.stringify(payload) });
  statoApp.contatti = statoApp.contatti.map(c => c.id === id ? res.contatto : c);
  statoApp.riepilogo = res.riepilogo;
  aggiornaMetaSidebar();
  if (msg) mostraToast(msg);
  return res.contatto;
}

async function generaSuggerimentoAi(id) {
  const res = await api("/api/ai/genera", { method:"POST", body: JSON.stringify({ contattoId: id }) });
  statoApp.contatti = statoApp.contatti.map(c => c.id === id ? res.contatto : c);
  aggiornaMetaSidebar();
  mostraToast("Suggerimento aggiornato");
  renderRoute(res.contatto);
}

async function copiaTesto(testo, btn) {
  try {
    await navigator.clipboard.writeText(testo);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = testo; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove();
  }
  if (btn) btn.textContent = "Copiato ✓";
  mostraToast("Messaggio copiato");
}

/* ─────────────── GRAFICI ─────────────── */
function contattiConCall(lista) {
  return lista.filter(c =>
    c.timeline.some(e => e.tipo === "call") ||
    ["Follow-up call effettuata","Follow-up post call","Abbonato","Disdettato"].includes(c.stato)
  );
}

function distribuzioneFrequenza(lista, fn) {
  const m = new Map();
  lista.forEach(el => { const k = fn(el) || "—"; m.set(k, (m.get(k)||0)+1); });
  return Array.from(m.entries())
    .map(([etichetta, valore], i) => ({ etichetta, valore, colore: COLORI_GRAFICI[i % COLORI_GRAFICI.length] }))
    .sort((a,b) => b.valore - a.valore);
}

function distribuzioneStati(lista) {
  const tot = Math.max(1, lista.length);
  return statoApp.statiPipeline.map((stato, i) => {
    const v = lista.filter(c => c.stato === stato).length;
    return { stato, valore: v, percentuale: Math.round((v/tot)*100), colore: COLORI_GRAFICI[i % COLORI_GRAFICI.length] };
  });
}

function conicGradient(voci) {
  const tot = voci.reduce((s,v) => s+v.valore, 0);
  if (!tot) return "conic-gradient(#e5ded2 0deg 360deg)";
  let acc = 0;
  return "conic-gradient(" + voci.map(v => {
    const s = acc; const g = (v.valore/tot)*360; acc += g;
    return `${v.colore} ${s}deg ${acc}deg`;
  }).join(", ") + ")";
}

function renderChartTorta(titolo, voci) {
  const tot = voci.reduce((s,v) => s+v.valore, 0);
  return `
    <article class="chart-card">
      <div class="section-head">
        <div><span class="eyebrow">Torta</span><h3>${escapeHtml(titolo)}</h3></div>
        <strong>${tot}</strong>
      </div>
      <div class="chart-pie-wrap">
        <div class="chart-pie" style="background:${conicGradient(voci)}"></div>
        <div class="chart-legend">
          ${voci.length
            ? voci.map(v => `
                <div class="legend-item">
                  <span class="legend-swatch" style="background:${v.colore}"></span>
                  <span class="text-xs">${escapeHtml(v.etichetta)}</span>
                  <strong>${v.valore}</strong>
                </div>`).join("")
            : `<p class="subtle text-sm">Nessun dato</p>`}
        </div>
      </div>
    </article>`;
}

function renderChartBarre(titolo, serie) {
  const max = Math.max(1, ...serie.map(v => v.valore));
  return `
    <article class="chart-card" style="grid-column: 1 / -1">
      <div class="section-head"><div><span class="eyebrow">Barre</span><h3>${escapeHtml(titolo)}</h3></div></div>
      <div class="bar-chart">
        ${serie.map(v => `
          <div class="bar-row">
            <span class="bar-label">${escapeHtml(v.stato)}</span>
            <div class="bar-track"><div class="bar-fill" style="width:${(v.valore/max)*100}%;background:${v.colore}"></div></div>
            <span class="bar-count">${v.valore}</span>
          </div>`).join("")}
      </div>
    </article>`;
}

function contattiPerOfferta(id) {
  return statoApp.contatti.filter(c =>
    (c.offerteProposteIds||[]).includes(id) || (c.offerteSottoscritteIds||[]).includes(id)
  );
}

/* ─────────────── PANNELLO AI ─────────────── */
function renderPannelloAi(contatto) {
  const focus = contatto || statoApp.contatti[0];
  if (!focus) {
    pannelloAi.innerHTML = `<div class="assistant-stack"><span class="eyebrow">Assistente AI</span><p class="subtle">Nessun contatto disponibile.</p></div>`;
    return;
  }

  pannelloAi.innerHTML = `
    <div class="assistant-stack">
      <div class="assistant-hero">
        <div>
          <span class="eyebrow">AI Assistant</span>
          <h3 style="color:#fffaf0;margin:6px 0 6px;font-size:16px">${escapeHtml(focus.stato)}</h3>
          <p style="font-size:13px">${escapeHtml(focus.insight)}</p>
        </div>
        <div class="score-orb">
          <span>${escapeHtml(focus.livelloPriorita)}</span>
          <strong>${focus.punteggioLead}</strong>
          <span>score</span>
        </div>
      </div>

      <div class="panel-card">
        <span class="eyebrow" style="margin-bottom:10px">Classificazione</span>
        <div class="ai-meta-grid">
          <div><span>Tipologia</span><strong>${escapeHtml(focus.tipologiaContatto)}</strong></div>
          <div><span>Punteggio</span><strong>${focus.punteggioLead}</strong></div>
          <div><span>Ruolo</span><strong>${escapeHtml(focus.ruolo)}</strong></div>
          <div><span>Azienda</span><strong>${escapeHtml(focus.azienda)}</strong></div>
        </div>
      </div>

      <div class="panel-card">
        <span class="eyebrow" style="margin-bottom:8px">Prossima azione</span>
        <p style="font-weight:700;font-size:14px;margin-bottom:8px">${escapeHtml(focus.prossimaAzione)}</p>
        <div class="message-surface">${escapeHtml(focus.messaggioSuggerito)}</div>
        <div class="actions-row" style="margin-top:12px">
          <button class="btn" id="copy-ai-msg">Copia</button>
          <button class="ghost-btn" id="refresh-ai">Refresh AI</button>
        </div>
      </div>

      <div class="panel-card">
        <span class="eyebrow" style="margin-bottom:10px">Offerte assegnate</span>
        <div class="offer-mini-list">
          ${offerteProposte(focus).map(o => `
            <div class="offer-mini-item">
              <strong>${escapeHtml(o.nome)}</strong>
              <span>${escapeHtml(o.tipologia)} · ${escapeHtml(o.prezzo)}</span>
            </div>`).join("") || `<p class="subtle text-sm">Nessuna offerta assegnata.</p>`}
        </div>
      </div>
    </div>`;

  document.getElementById("copy-ai-msg")?.addEventListener("click", e => copiaTesto(focus.messaggioSuggerito, e.currentTarget));
  document.getElementById("refresh-ai")?.addEventListener("click", e =>
    conBottone(e.currentTarget, "Aggiorno...", () => generaSuggerimentoAi(focus.id))
  );
}

/* ─────────────── DASHBOARD ─────────────── */
function renderDashboard() {
  const top = [...statoApp.contatti].sort((a,b) => b.punteggioLead - a.punteggioLead).slice(0,5);

  areaPrincipale.innerHTML = `
    <div class="hero-panel">
      <div>
        <span class="eyebrow">CRM · Pipeline · Offerte</span>
        <h1>Converti contatti LinkedIn in abbonati.</h1>
        <p>AITOBUSINESS separa clienti e partner, collega le offerte, traccia ogni stato della pipeline e guida il team dalla prima chat alla firma.</p>
        <div class="hero-actions">
          <a class="btn" href="/contatti" data-link>Apri contatti</a>
          <a class="ghost-btn" href="/pipeline" data-link style="color:#fffaf0;border-color:rgba(255,250,240,0.3);background:rgba(255,255,255,0.1)">Pipeline</a>
        </div>
      </div>
      <div class="hero-stats">
        <div class="hero-stat">
          <span>Abbonati</span>
          <strong>${statoApp.contatti.filter(c => c.stato === "Abbonato").length}</strong>
        </div>
        <div class="hero-stat">
          <span>Partner</span>
          <strong>${statoApp.contatti.filter(c => c.tipologiaContatto === "Potenziale Partner").length}</strong>
        </div>
        <div class="hero-stat">
          <span>Alta priorità</span>
          <strong>${statoApp.contatti.filter(c => c.livelloPriorita === "Alta").length}</strong>
        </div>
      </div>
    </div>

    <div class="metrics-grid">
      ${metricCard("Contatti", statoApp.contatti.length, "In piattaforma", "metric-ink")}
      ${metricCard("Da contattare", statoApp.contatti.filter(c => c.stato === "Da contattare").length, "Lead da attivare", "metric-accent")}
      ${metricCard("Follow-up post call", statoApp.contatti.filter(c => c.stato === "Follow-up post call").length, "In chiusura", "metric-gold")}
      ${metricCard("Offerte attive", statoApp.offerte.length, "Catalogo", "metric-muted")}
    </div>

    <div class="dashboard-grid">
      <article class="panel-card">
        <div class="section-head">
          <div><span class="eyebrow">Priorità commerciali</span><h3>Da lavorare oggi</h3></div>
        </div>
        <div class="priority-list">
          ${top.map(c => `
            <button class="priority-item" data-dettaglio="${c.id}">
              <span class="avatar">${iniziali(c.nome)}</span>
              <span class="priority-copy">
                <strong>${escapeHtml(c.nome)}</strong>
                <span>${escapeHtml(c.ruolo)} · ${escapeHtml(c.tipologiaContatto)}</span>
              </span>
              <span class="priority-meta">
                <span class="pill tone-${slugStato(c.stato)}">${escapeHtml(c.stato)}</span>
                <span class="pill pill-${c.livelloPriorita.toLowerCase()}">${escapeHtml(c.livelloPriorita)}</span>
              </span>
            </button>`).join("")}
        </div>
      </article>

      <article class="panel-card">
        <div class="section-head">
          <div><span class="eyebrow">Offerte attive</span><h3>Catalogo</h3></div>
        </div>
        <div class="offer-mini-list">
          ${statoApp.offerte.map(o => `
            <div class="offer-mini-item">
              <strong>${escapeHtml(o.nome)}</strong>
              <span>${escapeHtml(o.tipologia)} · ${escapeHtml(o.prezzo)} · Partner ${escapeHtml(o.percentualePartner)}</span>
            </div>`).join("")}
        </div>
      </article>
    </div>`;

  bindDettaglioContatto();
}

function metricCard(titolo, valore, dettaglio, cls = "") {
  return `
    <article class="metric-card ${cls}">
      <span class="eyebrow">${escapeHtml(titolo)}</span>
      <strong>${escapeHtml(String(valore))}</strong>
      <p class="subtle text-sm">${escapeHtml(dettaglio)}</p>
    </article>`;
}

/* ─────────────── CONTATTI ─────────────── */
function renderRigaContatto(c) {
  const primaOfferta = offerteProposte(c)[0];
  const tipoPill = c.tipologiaContatto === "Potenziale Partner"
    ? `<span class="pill pill-partner">Partner</span>`
    : `<span class="pill pill-cliente">Cliente</span>`;

  return `
    <tr>
      <td class="cell-name">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="avatar">${iniziali(c.nome)}</span>
          <div>
            <strong>${escapeHtml(c.nome)}</strong>
            <span>${escapeHtml(c.localita)}</span>
          </div>
        </div>
      </td>
      <td class="cell-role"><strong>${escapeHtml(c.ruolo)}</strong></td>
      <td class="cell-company">
        <strong>${escapeHtml(c.azienda)}</strong>
        <span>${escapeHtml(c.settore || "—")}</span>
      </td>
      <td>${tipoPill}</td>
      <td><span class="pill pill-${c.livelloPriorita.toLowerCase()}">${escapeHtml(c.livelloPriorita)}</span></td>
      <td><span class="pill tone-${slugStato(c.stato)}">${escapeHtml(c.stato)}</span></td>
      <td class="offer-link">
        ${primaOfferta
          ? `<strong>${escapeHtml(primaOfferta.nome)}</strong><span>${escapeHtml(primaOfferta.tipologia)} · ${escapeHtml(primaOfferta.prezzo)}</span>`
          : `<span class="subtle">—</span>`}
      </td>
      <td>
        <div class="cell-actions">
          <button class="small-btn" data-dettaglio="${c.id}">Open</button>
          <button class="small-btn" data-copy="${c.id}">Copy</button>
        </div>
      </td>
    </tr>`;
}

function renderContatti() {
  const lista = contattiFiltrati();
  areaPrincipale.innerHTML = `
    <div class="page-header-row">
      <div class="page-header">
        <span class="eyebrow">CRM</span>
        <h1>Contatti</h1>
        <p>Tabella con ruolo, tipologia cliente/partner, livello di priorità, stato pipeline e offerta collegata.</p>
      </div>
      <div class="header-actions">
        <a class="ghost-btn" href="/onboarding" data-link>Onboarding</a>
        <button class="ghost-btn" id="reset-demo">Reset</button>
        <button class="btn" id="export-csv">Export CSV</button>
      </div>
    </div>

    <div class="filter-shell">
      <div class="filter-grid">
        <input id="filtro-query" placeholder="Cerca nome, ruolo, azienda…" value="${escapeHtml(statoApp.filtri.query)}" />
        <select id="filtro-stato">
          <option value="">Tutti gli stati</option>
          ${statoApp.statiPipeline.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
        </select>
        <input id="filtro-localita" placeholder="Città…" value="${escapeHtml(statoApp.filtri.localita)}" />
        <select id="filtro-priorita">
          <option value="">Tutte le priorità</option>
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
      <div class="filter-row">
        <span class="filter-summary">${lista.length} righe · ${Object.values(statoApp.filtri).filter(Boolean).length} filtri attivi</span>
      </div>
    </div>

    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Nome</th>
            <th>Ruolo</th>
            <th>Azienda / Settore</th>
            <th>Tipologia</th>
            <th>Priorità</th>
            <th>Stato</th>
            <th>Offerta</th>
            <th>Azioni</th>
          </tr>
        </thead>
        <tbody>
          ${lista.length
            ? lista.map(renderRigaContatto).join("")
            : `<tr><td colspan="8"><div class="empty-state"><strong>Nessun contatto trovato.</strong><p>Modifica i filtri o importa nuovi dati.</p></div></td></tr>`}
        </tbody>
      </table>
    </div>`;

  document.getElementById("filtro-stato").value      = statoApp.filtri.stato;
  document.getElementById("filtro-priorita").value   = statoApp.filtri.livelloPriorita;
  document.getElementById("filtro-tipologia").value  = statoApp.filtri.tipologiaContatto;
  bindAzioniContatti();
}

function bindAzioniContatti() {
  document.getElementById("filtro-query")?.addEventListener("input", e => {
    clearTimeout(debounceRicerca);
    debounceRicerca = setTimeout(() => {
      statoApp.filtri.query = e.target.value;
      renderContatti(); bindNav();
    }, 120);
  });

  [
    ["filtro-stato", "stato"],
    ["filtro-localita", "localita"],
    ["filtro-priorita", "livelloPriorita"],
    ["filtro-tipologia", "tipologiaContatto"]
  ].forEach(([id, key]) => {
    const ev = id === "filtro-localita" ? "input" : "change";
    document.getElementById(id)?.addEventListener(ev, e => {
      statoApp.filtri[key] = e.target.value;
      renderContatti(); bindNav();
    });
  });

  document.getElementById("clear-filtri")?.addEventListener("click", () => {
    statoApp.filtri = { query:"",stato:"",localita:"",livelloPriorita:"",tipologiaContatto:"" };
    renderContatti(); bindNav();
  });

  document.getElementById("reset-demo")?.addEventListener("click", e =>
    conBottone(e.currentTarget, "Reset…", async () => {
      const r = await api("/api/reset", { method:"POST", body: JSON.stringify({}) });
      statoApp.contatti  = r.contatti;
      statoApp.riepilogo = r.riepilogo;
      aggiornaMetaSidebar();
      renderRoute();
    })
  );

  document.getElementById("export-csv")?.addEventListener("click", esportaCsv);
  bindDettaglioContatto();

  document.querySelectorAll("[data-copy]").forEach(btn => {
    btn.addEventListener("click", () => {
      const c = trovaContatto(btn.dataset.copy);
      if (c) copiaTesto(c.messaggioSuggerito, btn);
    });
  });
}

function esportaCsv() {
  const righe = [
    ["Nome","Ruolo","Azienda","Tipologia","Priorità","Stato","Offerta"],
    ...contattiFiltrati().map(c => [
      c.nome, c.ruolo, c.azienda, c.tipologiaContatto,
      c.livelloPriorita, c.stato, offerteProposte(c)[0]?.nome || ""
    ])
  ];
  const csv = righe.map(r => r.map(v => `"${String(v).replaceAll('"','""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type:"text/csv;charset=utf-8;" }));
  const a = Object.assign(document.createElement("a"), { href:url, download:"aitobusiness-contatti.csv" });
  a.click();
  URL.revokeObjectURL(url);
  mostraToast("CSV esportato");
}

/* ─────────────── DETTAGLIO CONTATTO ─────────────── */
async function renderDettaglioContatto(contatto) {
  if (!contatto) { navigate("/contatti"); return; }
  const payload = await api(`/api/contatti/${contatto.id}`);
  const c = payload.contatto;
  statoApp.contatti = statoApp.contatti.map(x => x.id === c.id ? c : x);

  areaPrincipale.innerHTML = `
    <div class="page-header-row">
      <div class="page-header">
        <span class="eyebrow">Scheda contatto</span>
        <h1>${escapeHtml(c.nome)}</h1>
        <p>${escapeHtml(c.ruolo)} · ${escapeHtml(c.azienda)} · ${escapeHtml(c.tipologiaContatto)}</p>
      </div>
      <div class="header-actions">
        <a class="ghost-btn" href="/contatti" data-link>← Indietro</a>
        <button class="btn" id="copy-dettaglio">Copia messaggio</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="contact-card">
        <div class="contact-hero">
          <span class="avatar lg">${iniziali(c.nome)}</span>
          <div>
            <h2>${escapeHtml(c.nome)}</h2>
            <p>${escapeHtml(c.ruolo)} · ${escapeHtml(c.azienda)}</p>
          </div>
        </div>

        <div class="meta-grid">
          <div class="meta-tile"><span class="eyebrow">Tipologia</span><strong>${escapeHtml(c.tipologiaContatto)}</strong></div>
          <div class="meta-tile"><span class="eyebrow">Priorità</span><strong>${escapeHtml(c.livelloPriorita)}</strong></div>
          <div class="meta-tile"><span class="eyebrow">Stato</span><strong>${escapeHtml(c.stato)}</strong></div>
          <div class="meta-tile"><span class="eyebrow">Settore</span><strong>${escapeHtml(c.settore || "—")}</strong></div>
          <div class="meta-tile"><span class="eyebrow">Punteggio</span><strong>${c.punteggioLead}</strong></div>
          <div class="meta-tile"><span class="eyebrow">Ultimo contatto</span><strong>${formattaData(c.ultimoContatto)}</strong></div>
        </div>

        <div class="linked-offers-block">
          <span class="eyebrow">Offerte proposte</span>
          <div class="offer-mini-list" style="margin-top:8px">
            ${payload.offerteProposte.map(o => `
              <div class="offer-mini-item">
                <strong>${escapeHtml(o.nome)}</strong>
                <span>${escapeHtml(o.tipologia)} · ${escapeHtml(o.prezzo)} · Partner ${escapeHtml(o.percentualePartner)}</span>
              </div>`).join("") || `<p class="subtle text-sm">Nessuna</p>`}
          </div>
        </div>

        <div class="linked-offers-block">
          <span class="eyebrow">Offerte sottoscritte</span>
          <div class="offer-mini-list" style="margin-top:8px">
            ${payload.offerteSottoscritte.length
              ? payload.offerteSottoscritte.map(o => `
                  <div class="offer-mini-item">
                    <strong>${escapeHtml(o.nome)}</strong>
                    <span>${escapeHtml(o.tipologia)} · ${escapeHtml(o.prezzo)}</span>
                  </div>`).join("")
              : `<p class="subtle text-sm">Nessuna sottoscrizione attiva</p>`}
          </div>
        </div>
      </div>

      <div class="timeline-panel">
        <div class="section-head"><div><span class="eyebrow">Timeline</span><h3>Interazioni</h3></div></div>
        <div class="timeline">
          ${c.timeline.map(ev => `
            <article class="timeline-card">
              <span class="eyebrow">${escapeHtml(ev.tipo)}</span>
              <h4>${formattaData(ev.data)}</h4>
              <p>${escapeHtml(ev.testo)}</p>
            </article>`).join("")}
        </div>
      </div>
    </div>`;

  document.getElementById("copy-dettaglio")?.addEventListener("click", e => copiaTesto(c.messaggioSuggerito, e.currentTarget));
}

/* ─────────────── PIPELINE (KANBAN) ─────────────── */
function renderPipeline() {
  areaPrincipale.innerHTML = `
    <div class="page-header">
      <span class="eyebrow">Pipeline</span>
      <h1>Kanban commerciale</h1>
      <p>Trascina le card tra le colonne per aggiornare lo stato nel database. Scorri orizzontalmente per vedere tutti gli stati.</p>
    </div>
    <div class="kanban-wrap">
      <div class="kanban-board">
        ${statoApp.statiPipeline.map(stato => {
          const lista = statoApp.contatti.filter(c => c.stato === stato);
          return `
            <div class="kanban-col" data-drop-stato="${escapeHtml(stato)}">
              <div class="kanban-col-head">
                <span class="eyebrow">${escapeHtml(stato)}</span>
                <span class="kanban-col-count">${lista.length}</span>
              </div>
              <div class="kanban-list">
                ${lista.map(c => `
                  <article class="kanban-card" draggable="true" data-drag-id="${c.id}">
                    <div class="kanban-card-top">
                      <span class="avatar">${iniziali(c.nome)}</span>
                      <div>
                        <strong>${escapeHtml(c.nome)}</strong>
                        <p>${escapeHtml(c.ruolo)}</p>
                      </div>
                    </div>
                    <div class="kanban-card-pills">
                      <span class="pill pill-${c.livelloPriorita.toLowerCase()}">${escapeHtml(c.livelloPriorita)}</span>
                      <span class="pill ${c.tipologiaContatto === 'Potenziale Partner' ? 'pill-partner' : 'pill-cliente'}">${c.tipologiaContatto === 'Potenziale Partner' ? 'Partner' : 'Cliente'}</span>
                    </div>
                    <div class="kanban-card-actions">
                      <button class="small-btn" data-dettaglio="${c.id}">Open</button>
                      <button class="small-btn" data-copy="${c.id}">Copy</button>
                    </div>
                  </article>`).join("")}
              </div>
            </div>`;
        }).join("")}
      </div>
    </div>`;

  bindDettaglioContatto();
  document.querySelectorAll("[data-copy]").forEach(btn =>
    btn.addEventListener("click", () => {
      const c = trovaContatto(btn.dataset.copy);
      if (c) copiaTesto(c.messaggioSuggerito, btn);
    })
  );

  document.querySelectorAll("[data-drag-id]").forEach(card => {
    card.addEventListener("dragstart", () => {
      idContattoDrag = card.dataset.dragId;
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => {
      idContattoDrag = null;
      card.classList.remove("is-dragging");
    });
  });

  document.querySelectorAll("[data-drop-stato]").forEach(col => {
    col.addEventListener("dragover", e => { e.preventDefault(); col.classList.add("is-drop-target"); });
    col.addEventListener("dragleave", () => col.classList.remove("is-drop-target"));
    col.addEventListener("drop", async e => {
      e.preventDefault();
      col.classList.remove("is-drop-target");
      if (!idContattoDrag) return;
      const nuovoStato = col.dataset.dropStato;
      const c = trovaContatto(idContattoDrag);
      if (!c || c.stato === nuovoStato) return;
      await aggiornaContatto(idContattoDrag, {
        stato: nuovoStato,
        ultimoContatto: oggi(),
        aggiungiEventoTimeline: { tipo:"stato", testo:`Spostato in ${nuovoStato}` }
      }, `Spostato in ${nuovoStato}`);
      renderRoute();
    });
  });
}

/* ─────────────── OFFERTE ─────────────── */
function renderOfferte() {
  areaPrincipale.innerHTML = `
    <div class="page-header-row">
      <div class="page-header">
        <span class="eyebrow">Catalogo offerte</span>
        <h1>Offerte</h1>
        <p>Offerte aziendali e in partnership collegate automaticamente ai contatti in base a tipologia e settore.</p>
      </div>
    </div>

    <div class="offers-grid">
      ${statoApp.offerte.map(o => {
        const collegati = statoApp.contatti.filter(c => (c.offerteProposteIds||[]).includes(o.id));
        const badgeCls  = o.tipologia === "partner" ? "offer-type-partner" : "offer-type-azienda";
        return `
          <article class="offer-card">
            <span class="offer-type-badge ${badgeCls}">${escapeHtml(o.tipologia)}</span>
            <h3>${escapeHtml(o.nome)}</h3>
            <p>${escapeHtml(o.descrizione)}</p>
            <div class="offer-meta-grid">
              <div><span>Prezzo</span><strong>${escapeHtml(o.prezzo)}</strong></div>
              <div><span>% Partner</span><strong>${escapeHtml(o.percentualePartner)}</strong></div>
            </div>
            <div class="offer-linked">
              <span class="eyebrow">Contatti collegati</span>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px">
                ${collegati.length
                  ? collegati.map(c => `<button class="small-btn" data-dettaglio="${c.id}">${escapeHtml(c.nome)}</button>`).join("")
                  : `<span class="subtle text-sm">Nessun contatto collegato</span>`}
              </div>
            </div>
          </article>`;
      }).join("")}
    </div>`;

  bindDettaglioContatto();
}

/* ─────────────── ANALYTICS ─────────────── */
function renderAnalytics() {
  const tutti = statoApp.contatti;
  const partner = tutti.filter(c => (c.offerteProposteIds||[]).some(id => trovaOfferta(id)?.tipologia === "partner"));

  areaPrincipale.innerHTML = `
    <div class="page-header">
      <span class="eyebrow">Analytics</span>
      <h1>Distribuzioni CRM</h1>
      <p>Grafici costruiti sui dati reali: ruoli, tipologie, stati di pipeline e breakdown per offerta.</p>
    </div>

    <div class="metrics-grid">
      ${metricCard("Totale contatti", tutti.length, "In piattaforma", "metric-ink")}
      ${metricCard("Con call", contattiConCall(tutti).length, "Call effettuate", "metric-accent")}
      ${metricCard("Abbonati", tutti.filter(c=>c.stato==="Abbonato").length, "Attivi", "metric-gold")}
      ${metricCard("KO", tutti.filter(c=>c.stato==="KO").length, "Chiusi negativi", "metric-muted")}
    </div>

    <div class="analytics-section">
      <div class="section-head"><div><span class="eyebrow">Ruolo</span><h3>Distribuzione per ruolo</h3></div></div>
      <div class="charts-grid">
        ${renderChartTorta("Tutti i contatti", distribuzioneFrequenza(tutti, c=>c.ruolo))}
        ${renderChartTorta("Contatti con call", distribuzioneFrequenza(contattiConCall(tutti), c=>c.ruolo))}
        ${renderChartBarre("Stati pipeline · Generale", distribuzioneStati(tutti))}
        ${renderChartBarre("Stati · Potenziali partner", distribuzioneStati(tutti.filter(c=>c.tipologiaContatto==="Potenziale Partner")))}
      </div>
    </div>

    <div class="analytics-section">
      <div class="section-head"><div><span class="eyebrow">Per offerta</span><h3>Breakdown dettagliato</h3></div></div>
      ${statoApp.offerte.map(o => {
        const ass = contattiPerOfferta(o.id);
        return `
          <div class="offer-analytics-card" style="margin-top:14px">
            <div class="section-head">
              <div><span class="eyebrow">${escapeHtml(o.tipologia)}</span><h3>${escapeHtml(o.nome)}</h3></div>
              <strong>${ass.length} contatti</strong>
            </div>
            <div class="charts-grid">
              ${renderChartTorta("Ruolo", distribuzioneFrequenza(ass, c=>c.ruolo))}
              ${renderChartTorta("Tipologia", distribuzioneFrequenza(ass, c=>c.tipologiaContatto))}
              ${renderChartBarre("Stati", distribuzioneStati(ass))}
            </div>
          </div>`;
      }).join("")}
    </div>`;
}

/* ─────────────── SUGGERIMENTI AI ─────────────── */
async function renderSuggerimentiAi() {
  const payload = await api("/api/suggerimenti-ai");
  areaPrincipale.innerHTML = `
    <div class="page-header">
      <span class="eyebrow">AI Suggerimenti</span>
      <h1>Prossime azioni</h1>
      <p>Messaggi pronti e suggerimenti ordinati per punteggio AI e stato della pipeline.</p>
    </div>
    <div class="suggestions-grid">
      ${payload.suggerimenti.map(item => `
        <article class="suggestion-card panel-card">
          <div class="suggestion-head">
            <div style="display:flex;align-items:center;gap:10px">
              <span class="avatar">${iniziali(item.nome)}</span>
              <div>
                <strong style="font-size:14px">${escapeHtml(item.nome)}</strong>
                <p class="subtle text-sm" style="margin:2px 0 0">${escapeHtml(item.azienda)}</p>
              </div>
            </div>
            <div class="score-block">
              <strong>${item.suggerimento.punteggio}</strong>
              <span>score</span>
            </div>
          </div>
          <span class="pill tone-${slugStato(item.suggerimento.statoLead)}">${escapeHtml(item.suggerimento.statoLead)}</span>
          <p style="font-weight:700;font-size:14px">${escapeHtml(item.suggerimento.prossimaAzione)}</p>
          <p class="subtle text-sm">${escapeHtml(item.suggerimento.insight)}</p>
          <div class="message-surface">${escapeHtml(item.suggerimento.messaggioSuggerito)}</div>
          <div class="actions-row">
            <button class="small-btn" data-dettaglio="${item.id}">Open</button>
            <button class="small-btn" data-copy="${item.id}">Copy</button>
            <button class="small-btn" data-ai="${item.id}">Refresh AI</button>
          </div>
        </article>`).join("")}
    </div>`;

  bindDettaglioContatto();
  document.querySelectorAll("[data-copy]").forEach(btn =>
    btn.addEventListener("click", () => {
      const c = trovaContatto(btn.dataset.copy);
      if (c) copiaTesto(c.messaggioSuggerito, btn);
    })
  );
  document.querySelectorAll("[data-ai]").forEach(btn =>
    btn.addEventListener("click", e => conBottone(e.currentTarget, "Aggiorno…", () => generaSuggerimentoAi(btn.dataset.ai)))
  );
}

/* ─────────────── ONBOARDING ─────────────── */
function renderOnboarding() {
  areaPrincipale.innerHTML = `
    <div class="page-header-row">
      <div class="page-header">
        <span class="eyebrow">Onboarding LinkedIn</span>
        <h1>Importa la lista</h1>
        <p>Scarica l'export da LinkedIn, carica i file CSV o JSON e AITOBUSINESS classificherà automaticamente ogni contatto.</p>
      </div>
      <div class="header-actions">
        <a class="ghost-btn" href="/contatti" data-link>Vai ai contatti</a>
      </div>
    </div>

    <div class="upload-hero-grid">
      <article class="upload-card">
        <span class="eyebrow">Upload</span>
        <h3 style="margin:8px 0 14px">Carica CSV o JSON</h3>
        <div class="dropzone">
          <strong>Trascina i file qui o selezionali</strong>
          <p>Campi supportati: nome, ruolo, azienda, localita, settore.</p>
          <input type="file" id="file-input" multiple accept=".csv,.json" />
        </div>
        <div class="form-actions">
          <button class="btn" id="importa-file">Importa</button>
          <button class="ghost-btn" id="carica-demo">Carica esempio</button>
        </div>
        <p class="subtle text-sm" id="stato-upload" style="margin-top:10px">Nessun file selezionato.</p>
        <div class="progress-bar" style="margin-top:10px"><span id="barra-progress"></span></div>
      </article>

      <article class="upload-card">
        <span class="eyebrow">Guida</span>
        <h3 style="margin:8px 0 14px">Come esportare da LinkedIn</h3>
        <div class="steps-list">
          <div class="step-item">1. Vai su LinkedIn → <strong>Impostazioni e privacy</strong></div>
          <div class="step-item">2. Sezione <strong>Privacy dei dati</strong> → "Ottieni una copia dei tuoi dati"</div>
          <div class="step-item">3. Seleziona <strong>Connections</strong>, richiedi e scarica lo ZIP</div>
          <div class="step-item">4. Estrai il file CSV e caricalo qui sopra</div>
        </div>
        <div style="margin-top:16px;padding:12px 14px;border-radius:var(--r-md);background:var(--c-gold-tint);font-size:13px;color:var(--c-ink-mid)">
          LinkedIn invia il file via email entro 10 minuti.
        </div>
      </article>
    </div>`;

  document.getElementById("file-input")?.addEventListener("change", e => {
    document.getElementById("stato-upload").textContent = `${e.target.files.length} file selezionati.`;
    document.getElementById("barra-progress").style.width = "40%";
  });

  document.getElementById("importa-file")?.addEventListener("click", e =>
    conBottone(e.currentTarget, "Importo…", async () => {
      const files = Array.from(document.getElementById("file-input").files || []);
      if (!files.length) { mostraToast("Seleziona almeno un file"); return; }
      const contatti = await parseUploadFiles(files);
      const r = await api("/api/import", { method:"POST", body: JSON.stringify({ contatti }) });
      statoApp.contatti = r.contatti; statoApp.riepilogo = r.riepilogo;
      aggiornaMetaSidebar();
      document.getElementById("stato-upload").textContent = `${r.importati} contatti importati.`;
      document.getElementById("barra-progress").style.width = "100%";
      mostraToast("Import completato");
    })
  );

  document.getElementById("carica-demo")?.addEventListener("click", e =>
    conBottone(e.currentTarget, "Carico…", async () => {
      const r = await api("/api/import", { method:"POST", body: JSON.stringify({ contatti: [{
        nome:"Sara Ferri", ruolo:"Partnership Manager", azienda:"Growth Studio",
        localita:"Bologna, IT", settore:"Agenzia", punteggioLead:88, stato:"Contattato"
      }] }) });
      statoApp.contatti = r.contatti; statoApp.riepilogo = r.riepilogo;
      aggiornaMetaSidebar();
      document.getElementById("stato-upload").textContent = "Contatto demo importato.";
      document.getElementById("barra-progress").style.width = "100%";
      mostraToast("Demo importato");
    })
  );
}

/* ─────────────── FILE UPLOAD / CSV PARSE ─────────────── */
async function parseUploadFiles(files) {
  const contatti = [];
  for (const f of files) {
    const text = await f.text();
    if (f.name.toLowerCase().endsWith(".json")) {
      const d = JSON.parse(text);
      contatti.push(...(Array.isArray(d) ? d : d.contatti || []));
    } else {
      contatti.push(...parseCsv(text));
    }
  }
  return contatti;
}

function parseCsv(text) {
  const righe = text.split(/\r?\n/).filter(Boolean);
  if (righe.length < 2) return [];
  const head = righe[0].split(",").map(h => h.trim().toLowerCase());
  return righe.slice(1).map(riga => {
    const vals = riga.split(",").map(v => v.trim());
    const r = {};
    head.forEach((h, i) => r[h] = vals[i] || "");
    return {
      nome:        r.nome || r.name || "Contatto importato",
      ruolo:       r.ruolo || r.role || "—",
      azienda:     r.azienda || r.company || "—",
      localita:    r.localita || r.location || "",
      settore:     r.settore || r.industry || "",
      punteggioLead: Number(r.punteggiolead || r.leadscore || 50),
      stato:       r.stato || "Da contattare"
    };
  });
}

/* ─────────────── ROUTING ─────────────── */
function bindDettaglioContatto() {
  document.querySelectorAll("[data-dettaglio]").forEach(btn =>
    btn.addEventListener("click", () => navigate(`/contatti/${btn.dataset.dettaglio}`))
  );
}

function navigate(path) {
  window.history.pushState({}, "", path);
  renderRoute();
}

function bindNav() {
  document.querySelectorAll("[data-link]").forEach(el => {
    el.addEventListener("click", e => {
      const href = el.getAttribute("href");
      if (!href?.startsWith("/")) return;
      e.preventDefault();
      navigate(href);
    });
  });
}

async function renderRoute(contattoPreferito = null) {
  impostaMenuAttivo();
  aggiornaMetaSidebar();
  const path = window.location.pathname;

  if (path === "/") { navigate("/dashboard"); return; }

  if (path === "/dashboard") {
    renderDashboard();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindNav(); return;
  }
  if (path === "/contatti") {
    renderContatti();
    renderPannelloAi(contattoPreferito || contattiFiltrati()[0] || statoApp.contatti[0]);
    bindNav(); return;
  }
  if (path === "/pipeline") {
    renderPipeline();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindNav(); return;
  }
  if (path === "/offerte") {
    renderOfferte();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindNav(); return;
  }
  if (path === "/analytics") {
    renderAnalytics();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindNav(); return;
  }
  if (path === "/onboarding") {
    renderOnboarding();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindNav(); return;
  }
  if (path === "/suggerimenti-ai") {
    await renderSuggerimentiAi();
    renderPannelloAi(contattoPreferito || statoApp.contatti[0]);
    bindNav(); return;
  }

  const m = path.match(/^\/contatti\/([^/]+)$/);
  if (m) {
    const c = trovaContatto(m[1]);
    await renderDettaglioContatto(contattoPreferito || c);
    renderPannelloAi(contattoPreferito || c);
    bindNav(); return;
  }

  navigate("/dashboard");
}

/* ─────────────── AVVIO ─────────────── */
window.addEventListener("popstate", () => renderRoute());

initMobileUI();

caricaDati()
  .then(renderRoute)
  .catch(err => {
    areaPrincipale.innerHTML = `
      <div class="panel-card" style="margin:20px">
        <span class="eyebrow">Errore</span>
        <h2>Impossibile avviare AITOBUSINESS</h2>
        <p class="subtle">${escapeHtml(err.message)}</p>
        <p class="subtle text-sm" style="margin-top:8px">Verifica che il server sia in esecuzione con <code>node server.js</code></p>
      </div>`;
  });
