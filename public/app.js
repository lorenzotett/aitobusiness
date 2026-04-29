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

const statoImport = { passo: 1, filesCaricati: [], anteprima: null, stats: null, payload: null, risultati: null };

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
  const [pContatti, pPrompt, pMeta, pOfferte] = await Promise.all([
    api("/api/contatti"),
    api("/api/prompt-ai"),
    api("/api/metadati"),
    api("/api/offerte")
  ]);
  statoApp.contatti      = pContatti.contatti;
  statoApp.riepilogo     = pContatti.riepilogo;
  statoApp.promptAi      = pPrompt.promptAi;
  statoApp.statiPipeline = pMeta.statiPipeline;
  statoApp.offerte       = pOfferte.offerte;
  aggiornaMetaSidebar();
}

/* ─────────────── OFFERTE CRUD ─────────────── */
async function creaOfferta(dati) {
  const res = await api("/api/offerte", { method: "POST", body: JSON.stringify(dati) });
  statoApp.offerte = res.offerte;
  aggiornaMetaSidebar();
  return res.offerta;
}

async function salvaModificheOfferta(id, dati) {
  const res = await api(`/api/offerte/${id}`, { method: "PATCH", body: JSON.stringify(dati) });
  statoApp.offerte = res.offerte;
  aggiornaMetaSidebar();
  return res.offerta;
}

async function eliminaOfferta(id) {
  const res = await api(`/api/offerte/${id}`, { method: "DELETE" });
  statoApp.offerte = res.offerte;
  aggiornaMetaSidebar();
}

async function assegnaOffertaContatto(offortaId, contattoId, campo, aggiunge) {
  const c = trovaContatto(contattoId);
  if (!c) return;
  const lista = [...(c[campo] || [])];
  if (aggiunge && !lista.includes(offortaId)) lista.push(offortaId);
  if (!aggiunge) { const i = lista.indexOf(offortaId); if (i !== -1) lista.splice(i, 1); }
  return aggiornaContatto(contattoId, { [campo]: lista });
}

function mostraModaleOfferta(offerta = null) {
  document.getElementById("modale-offerta")?.remove();
  const modale = document.createElement("div");
  modale.id = "modale-offerta";
  modale.className = "modal-overlay";
  modale.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${offerta ? "Modifica offerta" : "Nuova offerta"}</h3>
        <button class="icon-btn" id="chiudi-modale" aria-label="Chiudi">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="form-stack">
        <div class="form-field">
          <label>Nome *</label>
          <input id="of-nome" placeholder="es. Sprint Revenue Engine" value="${escapeHtml(offerta?.nome || '')}" />
        </div>
        <div class="form-field">
          <label>Descrizione</label>
          <textarea id="of-desc" rows="3" placeholder="Descrizione breve…">${escapeHtml(offerta?.descrizione || '')}</textarea>
        </div>
        <div class="form-field">
          <label>Tipologia</label>
          <select id="of-tipo">
            <option value="azienda" ${(!offerta || offerta.tipologia === 'azienda') ? 'selected' : ''}>Azienda</option>
            <option value="partner" ${offerta?.tipologia === 'partner' ? 'selected' : ''}>Partner</option>
          </select>
        </div>
        <div class="form-field">
          <label>Prezzo</label>
          <input id="of-prezzo" placeholder="es. EUR 1.900 o EUR 149/mese" value="${escapeHtml(offerta?.prezzo || '')}" />
        </div>
        <div class="form-field">
          <label>% Partner</label>
          <input id="of-partner" placeholder="es. 30%" value="${escapeHtml(offerta?.percentualePartner || '0%')}" />
        </div>
      </div>
      <div class="modal-actions">
        <button class="ghost-btn" id="annulla-modale">Annulla</button>
        <button class="btn" id="salva-offerta">${offerta ? "Salva modifiche" : "Crea offerta"}</button>
      </div>
    </div>`;
  document.body.appendChild(modale);

  const chiudi = () => modale.remove();
  document.getElementById("chiudi-modale")?.addEventListener("click", chiudi);
  document.getElementById("annulla-modale")?.addEventListener("click", chiudi);
  modale.addEventListener("click", e => { if (e.target === modale) chiudi(); });

  document.getElementById("salva-offerta")?.addEventListener("click", e =>
    conBottone(e.currentTarget, "Salvo…", async () => {
      const nome = document.getElementById("of-nome").value.trim();
      if (!nome) { mostraToast("Il nome è obbligatorio"); return; }
      const dati = {
        nome,
        descrizione: document.getElementById("of-desc").value.trim(),
        tipologia:   document.getElementById("of-tipo").value,
        prezzo:      document.getElementById("of-prezzo").value.trim(),
        percentualePartner: document.getElementById("of-partner").value.trim() || "0%"
      };
      if (offerta) {
        await salvaModificheOfferta(offerta.id, dati);
        mostraToast("Offerta aggiornata");
      } else {
        await creaOfferta(dati);
        mostraToast("Offerta creata");
      }
      chiudi();
      renderRoute();
    })
  );
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
          <div class="section-head" style="margin-bottom:8px">
            <span class="eyebrow">Offerte proposte</span>
          </div>
          <div class="offer-mini-list" id="lista-proposte">
            ${payload.offerteProposte.map(o => `
              <div class="offer-mini-item">
                <div>
                  <strong>${escapeHtml(o.nome)}</strong>
                  <span>${escapeHtml(o.tipologia)} · ${escapeHtml(o.prezzo)}</span>
                </div>
                <button class="icon-remove-btn" data-rm-det-proposta="${o.id}" title="Rimuovi">×</button>
              </div>`).join("") || `<p class="subtle text-sm">Nessuna</p>`}
          </div>
          <div class="assign-row" style="margin-top:8px">
            <select id="det-add-proposta">
              <option value="">Aggiungi offerta…</option>
              ${statoApp.offerte.filter(o => !c.offerteProposteIds?.includes(o.id))
                .map(o => `<option value="${o.id}">${escapeHtml(o.nome)}</option>`).join("")}
            </select>
            <button class="small-btn" id="btn-add-proposta">Aggiungi</button>
          </div>
        </div>

        <div class="linked-offers-block">
          <div class="section-head" style="margin-bottom:8px">
            <span class="eyebrow">Offerte sottoscritte</span>
          </div>
          <div class="offer-mini-list" id="lista-sottoscritte">
            ${payload.offerteSottoscritte.length
              ? payload.offerteSottoscritte.map(o => `
                  <div class="offer-mini-item">
                    <div>
                      <strong>${escapeHtml(o.nome)}</strong>
                      <span>${escapeHtml(o.tipologia)} · ${escapeHtml(o.prezzo)}</span>
                    </div>
                    <button class="icon-remove-btn" data-rm-det-sottoscritta="${o.id}" title="Rimuovi">×</button>
                  </div>`).join("")
              : `<p class="subtle text-sm">Nessuna sottoscrizione attiva</p>`}
          </div>
          <div class="assign-row" style="margin-top:8px">
            <select id="det-add-sottoscritta">
              <option value="">Aggiungi offerta…</option>
              ${statoApp.offerte.filter(o => !c.offerteSottoscritteIds?.includes(o.id))
                .map(o => `<option value="${o.id}">${escapeHtml(o.nome)}</option>`).join("")}
            </select>
            <button class="small-btn" id="btn-add-sottoscritta">Aggiungi</button>
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

  const ricaricaScheda = async () => {
    await renderDettaglioContatto(trovaContatto(c.id));
    renderPannelloAi(trovaContatto(c.id));
    bindNav();
  };

  document.querySelectorAll("[data-rm-det-proposta]").forEach(btn =>
    btn.addEventListener("click", e =>
      conBottone(e.currentTarget, "…", async () => {
        await assegnaOffertaContatto(btn.dataset.rmDetProposta, c.id, "offerteProposteIds", false);
        mostraToast("Offerta rimossa dalle proposte");
        await ricaricaScheda();
      })
    )
  );

  document.querySelectorAll("[data-rm-det-sottoscritta]").forEach(btn =>
    btn.addEventListener("click", e =>
      conBottone(e.currentTarget, "…", async () => {
        await assegnaOffertaContatto(btn.dataset.rmDetSottoscritta, c.id, "offerteSottoscritteIds", false);
        mostraToast("Offerta rimossa dalle sottoscrizioni");
        await ricaricaScheda();
      })
    )
  );

  document.getElementById("btn-add-proposta")?.addEventListener("click", e => {
    const sel = document.getElementById("det-add-proposta");
    if (!sel?.value) { mostraToast("Seleziona un'offerta"); return; }
    conBottone(e.currentTarget, "…", async () => {
      await assegnaOffertaContatto(sel.value, c.id, "offerteProposteIds", true);
      mostraToast("Offerta aggiunta alle proposte");
      await ricaricaScheda();
    });
  });

  document.getElementById("btn-add-sottoscritta")?.addEventListener("click", e => {
    const sel = document.getElementById("det-add-sottoscritta");
    if (!sel?.value) { mostraToast("Seleziona un'offerta"); return; }
    conBottone(e.currentTarget, "…", async () => {
      await assegnaOffertaContatto(sel.value, c.id, "offerteSottoscritteIds", true);
      mostraToast("Offerta aggiunta alle sottoscrizioni");
      await ricaricaScheda();
    });
  });
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
  const opzioniContatti = statoApp.contatti
    .map(c => `<option value="${c.id}">${escapeHtml(c.nome)} — ${escapeHtml(c.azienda)}</option>`)
    .join("");

  areaPrincipale.innerHTML = `
    <div class="page-header-row">
      <div class="page-header">
        <span class="eyebrow">Catalogo offerte</span>
        <h1>Offerte</h1>
        <p>Crea, modifica e collega le offerte ai contatti. Proposte e sottoscrizioni tracciate per ogni persona.</p>
      </div>
      <div class="header-actions">
        <button class="btn" id="nuova-offerta">+ Nuova offerta</button>
      </div>
    </div>

    <div class="offers-grid">
      ${statoApp.offerte.length === 0
        ? `<div class="empty-state"><strong>Nessuna offerta.</strong><p>Crea la prima offerta con il pulsante in alto.</p></div>`
        : statoApp.offerte.map(o => {
          const proposti     = statoApp.contatti.filter(c => (c.offerteProposteIds||[]).includes(o.id));
          const sottoscritti = statoApp.contatti.filter(c => (c.offerteSottoscritteIds||[]).includes(o.id));
          const badgeCls     = o.tipologia === "partner" ? "offer-type-partner" : "offer-type-azienda";
          return `
            <article class="offer-card" data-offer-id="${o.id}">
              <div class="offer-card-head">
                <span class="offer-type-badge ${badgeCls}">${escapeHtml(o.tipologia)}</span>
                <div class="offer-card-actions">
                  <button class="small-btn" data-edit-offer="${o.id}">Modifica</button>
                  <button class="small-btn btn-danger" data-delete-offer="${o.id}">Elimina</button>
                </div>
              </div>
              <h3 style="margin:10px 0 6px">${escapeHtml(o.nome)}</h3>
              <p class="subtle text-sm">${escapeHtml(o.descrizione)}</p>
              <div class="offer-meta-grid" style="margin-top:12px">
                <div><span>Prezzo</span><strong>${escapeHtml(o.prezzo)}</strong></div>
                <div><span>% Partner</span><strong>${escapeHtml(o.percentualePartner)}</strong></div>
              </div>

              <div class="offer-section">
                <span class="eyebrow">Proposte a (${proposti.length})</span>
                <div class="linked-contacts-list">
                  ${proposti.map(c => `
                    <div class="linked-contact-row">
                      <button class="small-btn" data-dettaglio="${c.id}">${escapeHtml(c.nome)}</button>
                      <button class="icon-remove-btn" data-rm-proposta="${c.id}" data-rm-offer="${o.id}" title="Rimuovi">×</button>
                    </div>`).join("") || `<span class="subtle text-sm">Nessuno</span>`}
                </div>
              </div>

              <div class="offer-section">
                <span class="eyebrow">Sottoscritti (${sottoscritti.length})</span>
                <div class="linked-contacts-list">
                  ${sottoscritti.map(c => `
                    <div class="linked-contact-row">
                      <button class="small-btn" data-dettaglio="${c.id}">${escapeHtml(c.nome)}</button>
                      <button class="icon-remove-btn" data-rm-sottoscritta="${c.id}" data-rm-offer="${o.id}" title="Rimuovi">×</button>
                    </div>`).join("") || `<span class="subtle text-sm">Nessuno</span>`}
                </div>
              </div>

              <div class="offer-assign-form">
                <span class="eyebrow" style="display:block;margin-bottom:8px">Assegna a contatto</span>
                <div class="assign-row">
                  <select class="assign-contact-sel" data-for-offer="${o.id}">
                    <option value="">Seleziona contatto…</option>
                    ${opzioniContatti}
                  </select>
                  <select class="assign-type-sel" data-type-for="${o.id}">
                    <option value="offerteProposteIds">Proposta</option>
                    <option value="offerteSottoscritteIds">Sottoscritta</option>
                  </select>
                  <button class="small-btn" data-assign-btn="${o.id}">Assegna</button>
                </div>
              </div>
            </article>`;
        }).join("")}
    </div>`;

  document.getElementById("nuova-offerta")?.addEventListener("click", () => mostraModaleOfferta());

  document.querySelectorAll("[data-edit-offer]").forEach(btn =>
    btn.addEventListener("click", () => {
      const o = statoApp.offerte.find(x => x.id === btn.dataset.editOffer);
      if (o) mostraModaleOfferta(o);
    })
  );

  document.querySelectorAll("[data-delete-offer]").forEach(btn =>
    btn.addEventListener("click", e =>
      conBottone(e.currentTarget, "…", async () => {
        if (!confirm("Eliminare questa offerta?")) return;
        await eliminaOfferta(btn.dataset.deleteOffer);
        mostraToast("Offerta eliminata");
        renderRoute();
      })
    )
  );

  document.querySelectorAll("[data-rm-proposta]").forEach(btn =>
    btn.addEventListener("click", e =>
      conBottone(e.currentTarget, "…", async () => {
        await assegnaOffertaContatto(btn.dataset.rmOffer, btn.dataset.rmProposta, "offerteProposteIds", false);
        mostraToast("Rimosso dalle proposte");
        renderRoute();
      })
    )
  );

  document.querySelectorAll("[data-rm-sottoscritta]").forEach(btn =>
    btn.addEventListener("click", e =>
      conBottone(e.currentTarget, "…", async () => {
        await assegnaOffertaContatto(btn.dataset.rmOffer, btn.dataset.rmSottoscritta, "offerteSottoscritteIds", false);
        mostraToast("Rimosso dalle sottoscrizioni");
        renderRoute();
      })
    )
  );

  document.querySelectorAll("[data-assign-btn]").forEach(btn =>
    btn.addEventListener("click", e => {
      const oid = btn.dataset.assignBtn;
      const contactSel = document.querySelector(`[data-for-offer="${oid}"]`);
      const typeSel    = document.querySelector(`[data-type-for="${oid}"]`);
      const cid  = contactSel?.value;
      const campo = typeSel?.value;
      if (!cid) { mostraToast("Seleziona un contatto"); return; }
      conBottone(e.currentTarget, "…", async () => {
        await assegnaOffertaContatto(oid, cid, campo, true);
        const label = campo === "offerteSottoscritteIds" ? "sottoscrizione" : "proposta";
        mostraToast(`Offerta aggiunta come ${label}`);
        renderRoute();
      });
    })
  );

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

/* ─────────────── ONBOARDING — WIZARD 4 STEP ─────────────── */

function renderOnboarding() {
  Object.assign(statoImport, { passo: 1, filesCaricati: [], anteprima: null, stats: null, payload: null, risultati: null });
  areaPrincipale.innerHTML = `
    <div class="page-header-row">
      <div class="page-header">
        <span class="eyebrow">Onboarding LinkedIn</span>
        <h1>Importa la lista</h1>
        <p>Carica il tuo export LinkedIn — AITOBUSINESS classificherà, scorerà e mapperà ogni contatto automaticamente.</p>
      </div>
    </div>
    <div id="wizard-root"></div>`;
  renderPasso();
}

function renderPasso() {
  const root = document.getElementById("wizard-root");
  if (!root) return;
  const labels = ["Carica", "Anteprima", "Importa", "Completato"];
  const stepBar = `
    <div class="wizard-nav">
      ${labels.map((lab, i) => {
        const n = i + 1;
        const cls = n < statoImport.passo ? "done" : n === statoImport.passo ? "active" : "";
        return `
          ${i > 0 ? '<div class="wizard-connector"></div>' : ""}
          <div class="wizard-step ${cls}">
            <span class="step-dot">${n < statoImport.passo ? "✓" : n}</span>
            <span class="step-label">${lab}</span>
          </div>`;
      }).join("")}
    </div>`;
  let corpo = "";
  if (statoImport.passo === 1) corpo = htmlPassoCarica();
  else if (statoImport.passo === 2) corpo = htmlPassoAnteprima();
  else if (statoImport.passo === 3) corpo = htmlPassoImportando();
  else corpo = htmlPassoCompletato();
  root.innerHTML = stepBar + corpo;
  bindPasso();
}

/* ── Step 1: Carica ── */
function htmlPassoCarica() {
  const filesHtml = statoImport.filesCaricati.map(f => {
    const icona = f.name.toLowerCase().endsWith(".zip") ? "🗜️" : "📄";
    return `<div class="file-chip"><span>${icona} ${escapeHtml(f.name)}</span><span class="subtle text-xs">${(f.size/1024).toFixed(1)} KB</span></div>`;
  }).join("");
  return `
    <div class="wizard-card">
      <div class="upload-zone" id="upload-zone">
        <div class="upload-zone-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </div>
        <strong>Trascina qui i file LinkedIn</strong>
        <p class="subtle text-sm" style="margin:6px 0 14px">LinkedIn.zip · Connections.csv · messages.csv · .json</p>
        <label class="btn" style="cursor:pointer">
          Seleziona file
          <input type="file" id="file-input" multiple accept=".zip,.csv,.json,.txt" style="position:absolute;opacity:0;width:0;height:0">
        </label>
      </div>

      <div id="files-list" style="margin-top:10px">${filesHtml}</div>

      <details class="guide-accordion">
        <summary class="guide-toggle">📖 Come esportare da LinkedIn</summary>
        <div class="guide-body">
          <div class="steps-list">
            <div class="step-item">1. Vai su LinkedIn → <strong>Impostazioni e privacy</strong></div>
            <div class="step-item">2. <strong>Privacy dei dati</strong> → "Ottieni una copia dei tuoi dati"</div>
            <div class="step-item">3. Seleziona <strong>Connections</strong> (opz. Messages) e richiedi l'export</div>
            <div class="step-item">4. Scarica lo ZIP dalla mail, estrai i CSV e caricali qui</div>
          </div>
          <div class="guide-tip">💡 LinkedIn invia il file entro ~10 minuti via email</div>
        </div>
      </details>

      <div class="wizard-actions">
        <button class="ghost-btn" id="btn-carica-demo">Carica contatto demo</button>
        <button class="btn" id="btn-analizza" ${statoImport.filesCaricati.length ? "" : "disabled"}>Analizza →</button>
      </div>
    </div>`;
}

/* ── Step 2: Anteprima ── */
function htmlPassoAnteprima() {
  const { anteprima, stats } = statoImport;
  if (!anteprima || !stats) return `<div class="wizard-card"><p>Nessun dato disponibile.</p></div>`;
  const banner = stats.trovati > 300
    ? `<div class="info-banner">📋 Mostro i primi 300 su ${stats.trovati} trovati. Saranno importati tutti.</div>` : "";
  return `
    <div class="wizard-card">
      <div class="import-stats-grid">
        ${importStatCard(stats.trovati,      "Contatti trovati", "metric-ink")}
        ${importStatCard(stats.nuovi,        "Nuovi",            "metric-accent")}
        ${importStatCard(stats.duplicati,    "Già presenti",     "metric-muted")}
        ${importStatCard(stats.conMessaggi || 0, "Con messaggi", "metric-gold")}
        ${importStatCard(stats.conInvito   || 0, "Invitati",     "")}
      </div>
      ${banner}
      <div class="table-wrap preview-scroll">
        <table>
          <thead>
            <tr>
              <th>Nome</th><th>Ruolo · Azienda</th>
              <th>Score</th><th>Msg</th><th>Stato</th><th></th>
            </tr>
          </thead>
          <tbody>
            ${anteprima.map(c => `
              <tr class="${c.isDuplicate ? "row-dup" : ""}">
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <span class="avatar" style="width:28px;height:28px;font-size:10px">${iniziali(c.nome)}</span>
                    <div>
                      <strong style="font-size:13px">${escapeHtml(c.nome)}</strong>
                      ${c.linkedinUrl ? `<a href="${escapeHtml(c.linkedinUrl)}" target="_blank" class="subtle text-xs" style="display:block;text-decoration:none">↗ LinkedIn</a>` : ""}
                    </div>
                  </div>
                </td>
                <td class="text-sm">
                  <div>${escapeHtml(c.ruolo)}</div>
                  <div class="subtle text-xs">${escapeHtml(c.azienda)}</div>
                </td>
                <td style="font-weight:700;color:var(--c-green)">${c.punteggioLead}</td>
                <td class="text-sm">${c.messaggiCount > 0 ? `<span style="color:var(--c-green)">💬 ${c.messaggiCount}</span>` : `<span class="subtle">—</span>`}</td>
                <td><span class="pill ${c.tipologiaContatto==="Potenziale Partner"?"pill-partner":"pill-cliente"}" style="font-size:10px">${c.tipologiaContatto==="Potenziale Partner"?"Partner":"Cliente"}</span></td>
                <td>${c.isDuplicate ? '<span class="badge-dup">già presente</span>' : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div class="wizard-actions">
        <button class="ghost-btn" id="btn-indietro">← Indietro</button>
        <button class="btn" id="btn-importa">Importa ${stats.nuovi} nuovi →</button>
      </div>
    </div>`;
}

/* ── Step 3: Importando ── */
function htmlPassoImportando() {
  return `
    <div class="wizard-card wizard-center">
      <div class="spinner" style="margin:0 auto 24px"></div>
      <h3>Importazione in corso…</h3>
      <p class="subtle" style="margin-top:8px">Classifico i lead, calcolo i punteggi e aggiorno la pipeline.</p>
      <div class="progress-bar" style="margin-top:24px"><span id="barra-import" style="width:5%"></span></div>
    </div>`;
}

/* ── Step 4: Completato ── */
function htmlPassoCompletato() {
  const r = statoImport.risultati || {};
  return `
    <div class="wizard-card wizard-center">
      <div class="success-checkmark">✅</div>
      <h2 style="margin:16px 0 6px">Import completato!</h2>
      <p class="subtle">I tuoi contatti LinkedIn sono pronti nella piattaforma.</p>
      <div class="import-stats-grid" style="margin:24px 0">
        ${importStatCard(r.importati||0, "Importati", "metric-accent")}
        ${importStatCard(r.totale||0, "Totale CRM", "metric-ink")}
      </div>
      <div class="wizard-actions" style="justify-content:center;flex-wrap:wrap">
        <a class="btn" href="/contatti" data-link>Vai ai Contatti</a>
        <a class="ghost-btn" href="/pipeline" data-link>Apri Pipeline</a>
        <button class="ghost-btn" id="btn-nuovo-import">Nuovo Import</button>
      </div>
    </div>`;
}

function importStatCard(val, label, cls = "") {
  return `<div class="import-stat-card ${cls}"><strong>${val}</strong><span>${label}</span></div>`;
}

/* ── Bindings per ogni step ── */
function bindPasso() {
  // Step 1
  const fileInput = document.getElementById("file-input");
  const btnAnalizza = document.getElementById("btn-analizza");
  const uploadZone = document.getElementById("upload-zone");

  fileInput?.addEventListener("change", e => {
    statoImport.filesCaricati = Array.from(e.target.files);
    aggiornaListaFile();
    if (btnAnalizza) btnAnalizza.disabled = !statoImport.filesCaricati.length;
  });

  uploadZone?.addEventListener("dragover", e => { e.preventDefault(); uploadZone.classList.add("drag-over"); });
  uploadZone?.addEventListener("dragleave", () => uploadZone.classList.remove("drag-over"));
  uploadZone?.addEventListener("drop", e => {
    e.preventDefault(); uploadZone.classList.remove("drag-over");
    const accettati = [".zip", ".csv", ".json", ".txt"];
    statoImport.filesCaricati = Array.from(e.dataTransfer.files)
      .filter(f => accettati.some(ext => f.name.toLowerCase().endsWith(ext)));
    aggiornaListaFile();
    if (btnAnalizza) btnAnalizza.disabled = !statoImport.filesCaricati.length;
  });

  btnAnalizza?.addEventListener("click", e =>
    conBottone(e.currentTarget, "Analizzo…", analizzaFiles)
  );

  document.getElementById("btn-carica-demo")?.addEventListener("click", e =>
    conBottone(e.currentTarget, "Carico…", async () => {
      const r = await api("/api/import", { method:"POST", body: JSON.stringify({ contatti: [{
        nome:"Sara Ferri", ruolo:"Partnership Manager", azienda:"Growth Studio",
        localita:"Bologna, IT", settore:"Agenzia", punteggioLead:88, stato:"Contattato"
      }] }) });
      statoApp.contatti = r.contatti; statoApp.riepilogo = r.riepilogo;
      aggiornaMetaSidebar();
      mostraToast("Contatto demo importato");
      navigate("/contatti");
    })
  );

  // Step 2
  document.getElementById("btn-indietro")?.addEventListener("click", () => {
    statoImport.passo = 1; renderPasso(); bindNav();
  });
  document.getElementById("btn-importa")?.addEventListener("click", () => eseguiImport());

  // Step 4
  document.getElementById("btn-nuovo-import")?.addEventListener("click", () => {
    Object.assign(statoImport, { passo:1, filesCaricati:[], anteprima:null, stats:null, payload:null, risultati:null });
    renderPasso(); bindNav();
  });

  bindNav();
}

function aggiornaListaFile() {
  const el = document.getElementById("files-list");
  if (!el) return;
  el.innerHTML = statoImport.filesCaricati.map(f => {
    const icona = f.name.toLowerCase().endsWith(".zip") ? "🗜️" : "📄";
    const dim   = f.size > 1024 * 1024 ? `${(f.size/1024/1024).toFixed(1)} MB` : `${(f.size/1024).toFixed(1)} KB`;
    return `<div class="file-chip"><span>${icona} ${escapeHtml(f.name)}</span><span class="subtle text-xs">${dim}</span></div>`;
  }).join("");
}

/* ─────────────── ZIP PARSER (puro JS, zero dipendenze) ─────────────── */

// Solo i file LinkedIn che usiamo realmente (evita di estrarre reactions 1MB, ads 747KB, ecc.)
const ZIP_FILES_UTILI = new Set([
  "connections.csv", "messages.csv", "profile.csv",
  "invitations.csv", "importedcontacts.csv",
  "positions.csv", "skills.csv", "education.csv"
]);

async function decomprimi(bytes, compData, method) {
  if (method === 0) return new TextDecoder("utf-8").decode(compData); // Stored
  if (method !== 8) return null; // Metodo non supportato
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();
  writer.write(compData);
  writer.close();
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totLen = chunks.reduce((s, c) => s + c.length, 0);
  const combined = new Uint8Array(totLen);
  let off = 0;
  for (const c of chunks) { combined.set(c, off); off += c.length; }
  return new TextDecoder("utf-8").decode(combined);
}

async function extraiZIP(arrayBuffer) {
  const view  = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  const dec   = new TextDecoder("utf-8");

  // Trova EOCD (End of Central Directory) — firma 0x06054b50
  let eocdPos = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos === -1) throw new Error("File ZIP non valido o corrotto");

  const numEntries = view.getUint16(eocdPos + 8, true);
  let   cdPos      = view.getUint32(eocdPos + 16, true);
  const files      = {};

  for (let i = 0; i < numEntries; i++) {
    if (view.getUint32(cdPos, true) !== 0x02014b50) break;

    const method      = view.getUint16(cdPos + 10, true);
    const compSize    = view.getUint32(cdPos + 20, true);
    const fnLen       = view.getUint16(cdPos + 28, true);
    const exLen       = view.getUint16(cdPos + 30, true);
    const cmLen       = view.getUint16(cdPos + 32, true);
    const localOffset = view.getUint32(cdPos + 42, true);
    const filename    = dec.decode(bytes.slice(cdPos + 46, cdPos + 46 + fnLen));
    cdPos += 46 + fnLen + exLen + cmLen;

    const baseName = filename.split("/").pop().toLowerCase().trim();
    if (filename.endsWith("/") || compSize === 0) continue;
    // Estrai SOLO i file che usiamo — evita reactions/ads/searchqueries (MB inutili)
    if (!ZIP_FILES_UTILI.has(baseName)) continue;

    const localFnLen = view.getUint16(localOffset + 26, true);
    const localExLen = view.getUint16(localOffset + 28, true);
    const dataStart  = localOffset + 30 + localFnLen + localExLen;
    const compData   = bytes.slice(dataStart, dataStart + compSize);

    try {
      const testo = await decomprimi(bytes, compData, method);
      if (testo) files[baseName] = testo;
    } catch { /* file corrotto — ignora */ }
  }

  return files;
}

/* ─────────────── PRE-AGGREGAZIONE MESSAGGI (browser) ─────────────── */
// Converte messages.csv (3MB) in un JSON compatto (~30KB) prima di inviarlo al server

function normNomeBrowser(s) {
  return (s || "").toLowerCase().trim()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function profiloNomeDaCSV(testo) {
  const righe = testo.replace(/^﻿/, "").split(/\r?\n/).filter(r => r.trim());
  if (righe.length < 2) return "";
  // Header: First Name,Last Name,...
  const cols = righe[0].split(",").map(c => c.toLowerCase().replace(/[" ]+/g, ""));
  const vals = righe[1].split(",").map(c => c.trim().replace(/^"|"$/g, ""));
  const iF = cols.findIndex(c => c.includes("firstname"));
  const iL = cols.findIndex(c => c.includes("lastname"));
  return [iF >= 0 ? vals[iF] : "", iL >= 0 ? vals[iL] : ""].filter(Boolean).join(" ");
}

function aggregaMessaggiBrowser(csvText, nomeUtente) {
  const testo  = csvText.replace(/^﻿/, "");
  const nomeU  = normNomeBrowser(nomeUtente || "");
  const parPos = ["interessato","voglio","fissiamo","volentieri","perfetto","ottimo","certo",
    "assolutamente","disponibile","procediamo","sounds good","would love","interested",
    "great","yes","sure","absolutely","grazie","quando"];
  const parNeg = ["no grazie","non sono interessato","spam","stop","remove me",
    "unsubscribe","not interested","no thanks"];

  // Parser CSV carattere per carattere (gestisce campi multiriga come il body del messaggio)
  let pos = 0; const len = testo.length;

  function leggiCampo() {
    if (pos >= len) return "";
    let campo = "";
    if (testo[pos] === '"') {
      pos++;
      while (pos < len) {
        if (testo[pos] === '"') {
          pos++;
          if (pos < len && testo[pos] === '"') { campo += '"'; pos++; }
          else break;
        } else { campo += testo[pos++]; }
      }
    } else {
      while (pos < len && testo[pos] !== "," && testo[pos] !== "\n" && testo[pos] !== "\r") {
        campo += testo[pos++];
      }
    }
    return campo.trim();
  }

  function leggiRiga() {
    const row = [];
    while (pos < len) {
      row.push(leggiCampo());
      if (pos < len && testo[pos] === ",") { pos++; continue; }
      if (pos < len && testo[pos] === "\r") pos++;
      if (pos < len && testo[pos] === "\n") { pos++; break; }
      break;
    }
    return row;
  }

  // Trova header (salta eventuali righe di note prima)
  let header = [];
  for (let t = 0; t < 5 && pos < len; t++) {
    const row = leggiRiga();
    const low = row.map(f => f.toLowerCase().replace(/[\s"_\-]+/g, ""));
    if (low.some(f => f.includes("conversationid"))) { header = low; break; }
  }
  if (!header.length) return [];

  const ci = (name) => header.findIndex(f => f.includes(name.replace(/[\s_\-]+/g, "").toLowerCase()));
  const iFrom    = ci("from");
  const iFromUrl = ci("senderprofileurl");
  const iTo      = ci("to");
  const iToUrl   = ci("recipientprofileurls");
  const iDate    = ci("date");
  const iContent = ci("content");

  const byUrl  = new Map();
  const byNome = new Map();

  while (pos < len) {
    const row = leggiRiga();
    if (!row.length || (row.length === 1 && !row[0])) continue;
    const g = (i) => (i >= 0 && row[i]) ? row[i].trim() : "";

    const from    = g(iFrom);
    const fromUrl = g(iFromUrl);
    const to      = g(iTo);
    const toUrl   = g(iToUrl).split(",")[0].trim();
    const date    = g(iDate).slice(0, 10);       // YYYY-MM-DD
    const content = g(iContent).toLowerCase();

    if (!from) continue;
    const fromNorm   = normNomeBrowser(from);
    const fromIsUser = nomeU && (fromNorm === nomeU ||
      (nomeU.split(" ")[0].length > 2 && fromNorm.startsWith(nomeU.split(" ")[0])));

    const otherName = fromIsUser ? to   : from;
    const otherUrl  = fromIsUser ? toUrl : fromUrl;
    if (!otherName) continue;

    const map = otherUrl ? byUrl : byNome;
    const key = otherUrl || normNomeBrowser(otherName);
    if (!map.has(key)) map.set(key, { nome: otherName, url: otherUrl || "", count: 0, ultimaData: "", sentimento: "Neutro" });
    const s = map.get(key);
    s.count++;
    if (date > s.ultimaData) s.ultimaData = date;
    if (s.sentimento !== "Positivo") {
      if (parPos.some(p => content.includes(p))) s.sentimento = "Positivo";
      else if (parNeg.some(p => content.includes(p))) s.sentimento = "Negativo";
    }
  }

  const result = [];
  for (const [, s] of byUrl)  result.push({ ...s, tipoKey: "url" });
  for (const [, s] of byNome) result.push({ ...s, tipoKey: "nome" });
  return result;
}

async function analizzaFiles() {
  const files = statoImport.filesCaricati;
  if (!files.length) { mostraToast("Seleziona almeno un file"); return; }

  const haZIP = files.some(f => f.name.toLowerCase().endsWith(".zip"));
  const root  = document.getElementById("wizard-root");

  const setStatus = (msg) => {
    let el = document.getElementById("zip-status");
    if (!el && msg) {
      root?.insertAdjacentHTML("afterbegin",
        `<div class="info-banner" id="zip-status" style="margin-bottom:12px">${msg}</div>`);
    } else if (el && msg) {
      el.textContent = msg;
    } else if (el && !msg) {
      el.remove();
    }
  };

  if (haZIP) setStatus("⏳ Lettura ZIP in corso…");

  const filesPayload = [];
  const errori = [];

  for (const f of files) {
    if (f.name.toLowerCase().endsWith(".zip")) {
      try {
        setStatus(`🗜️ Estrazione "${f.name}"… (qualche secondo)`);
        const buffer   = await f.arrayBuffer();
        const estratti = await extraiZIP(buffer);
        const trovati  = Object.entries(estratti);
        if (!trovati.length) {
          errori.push("Nessun file LinkedIn riconosciuto nel ZIP. Carica l'export originale di LinkedIn.");
          continue;
        }
        setStatus(`📂 Estratti ${trovati.length} file — elaborazione…`);

        // Separa messages.csv dagli altri per pre-aggregarlo nel browser
        // (evita di inviare 3MB al server — Vercel ha limite 4.5MB)
        let nomeUtente = "";
        const profileEntry = trovati.find(([n]) => n === "profile.csv");
        if (profileEntry) nomeUtente = profiloNomeDaCSV(profileEntry[1]);

        for (const [nome, contenuto] of trovati) {
          if (nome === "messages.csv") {
            setStatus(`💬 Pre-elaborazione messaggi (${(contenuto.length/1024/1024).toFixed(1)} MB)…`);
            const summary = aggregaMessaggiBrowser(contenuto, nomeUtente);
            setStatus(`✅ ${summary.length} conversazioni analizzate`);
            // Invia il riassunto compatto (~30KB) invece del CSV grezzo (3MB)
            filesPayload.push({ nome: "messages_summary.json", contenuto: JSON.stringify(summary) });
          } else {
            filesPayload.push({ nome, contenuto });
          }
        }
      } catch (e) {
        errori.push(`Errore ZIP: ${e.message}`);
      }
    } else {
      filesPayload.push({ nome: f.name, contenuto: await f.text() });
    }
  }

  if (errori.length) { setStatus(null); mostraToast(errori[0]); return; }
  if (!filesPayload.length) { setStatus(null); mostraToast("Nessun dato da importare"); return; }

  const totaleKB = Math.round(filesPayload.reduce((s, f) => s + f.contenuto.length, 0) / 1024);
  setStatus(`📊 Invio dati al server (${totaleKB} KB)…`);

  try {
    const res = await api("/api/import/preview", { method:"POST", body: JSON.stringify({ files: filesPayload }) });
    setStatus(null);
    statoImport.anteprima = res.anteprima;
    statoImport.stats     = res.stats;
    statoImport.payload   = res._payload;
    statoImport.passo = 2;
    renderPasso(); bindNav();
  } catch(e) {
    setStatus(null);
    mostraToast(`Errore: ${e.message}`);
  }
}

async function eseguiImport() {
  statoImport.passo = 3; renderPasso();
  const barra = document.getElementById("barra-import");
  let p = 5;
  const tick = setInterval(() => {
    p = Math.min(88, p + Math.random() * 12);
    if (barra) barra.style.width = `${p}%`;
  }, 250);
  try {
    const res = await api("/api/import", { method:"POST", body: JSON.stringify({ _payload: statoImport.payload }) });
    clearInterval(tick);
    if (barra) barra.style.width = "100%";
    statoApp.contatti = res.contatti; statoApp.riepilogo = res.riepilogo;
    aggiornaMetaSidebar();
    await new Promise(r => setTimeout(r, 400));
    statoImport.risultati = res;
    statoImport.passo = 4;
    renderPasso(); bindNav();
  } catch (e) {
    clearInterval(tick);
    mostraToast(`Errore: ${e.message}`);
    statoImport.passo = 2; renderPasso();
  }
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
