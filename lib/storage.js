const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");

const IS_VERCEL = Boolean(process.env.VERCEL);
const cartellaDatiBundle = path.join(__dirname, "..", "data");
const cartellaDati = IS_VERCEL ? path.join("/tmp", "aito-business-data") : cartellaDatiBundle;
const cartellaTemp = path.join(cartellaDati, "tmp");
const fileContattiLegacy = path.join(cartellaDatiBundle, "contatti.json");
const fileDatabase = path.join(cartellaDati, "aito.sqlite");

let db = null;

function assicuraCartella(percorso) {
  if (!fs.existsSync(percorso)) {
    fs.mkdirSync(percorso, { recursive: true });
  }
}

function assicuraStorage(contattiPredefiniti = []) {
  assicuraCartella(cartellaDati);
  assicuraCartella(cartellaTemp);
  db = new DatabaseSync(fileDatabase);
  db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS contatti (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS importazioni_linkedin (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS impostazioni_ai (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS utenti (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nome TEXT NOT NULL,
      ruolo TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessioni (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES utenti(id)
    );
  `);

  const totaleContatti = db.prepare("SELECT COUNT(*) AS totale FROM contatti").get().totale;
  if (totaleContatti === 0) {
    const seed = leggiLegacyContatti(contattiPredefiniti);
    if (seed.length) {
      salvaContatti(seed, "demo-user");
    }
  }
}

function leggiLegacyContatti(fallback) {
  try {
    if (fs.existsSync(fileContattiLegacy)) {
      return JSON.parse(fs.readFileSync(fileContattiLegacy, "utf8"));
    }
  } catch (_errore) {
    return fallback;
  }
  return fallback;
}

function nowIso() {
  return new Date().toISOString();
}

function serializza(valore) {
  return JSON.stringify(valore);
}

function parsePayload(row, fallback = null) {
  if (!row) return fallback;
  try {
    return JSON.parse(row.payload);
  } catch (_errore) {
    return fallback;
  }
}

function leggiContatti(userId = "demo-user") {
  const rows = db
    .prepare("SELECT payload FROM contatti WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId);
  return rows.map((row) => parsePayload(row, {})).filter(Boolean);
}

function salvaContatti(contatti, userId = "demo-user") {
  const cancella = db.prepare("DELETE FROM contatti WHERE user_id = ?");
  const inserisci = db.prepare(`
    INSERT INTO contatti (id, user_id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const now = nowIso();
  db.exec("BEGIN");
  try {
    cancella.run(userId);
    contatti.forEach((contatto) => {
      inserisci.run(`${userId}:${contatto.id}`, userId, serializza(contatto), now, now);
    });
    db.exec("COMMIT");
  } catch (errore) {
    db.exec("ROLLBACK");
    throw errore;
  }
}

function leggiImportazioniLinkedin(userId = null) {
  const sql = userId
    ? "SELECT payload FROM importazioni_linkedin WHERE user_id = ? ORDER BY updated_at DESC"
    : "SELECT payload FROM importazioni_linkedin ORDER BY updated_at DESC";
  const rows = userId ? db.prepare(sql).all(userId) : db.prepare(sql).all();
  return rows.map((row) => parsePayload(row, {})).filter(Boolean);
}

function salvaImportazioniLinkedin(importazioni) {
  const inserisci = db.prepare(`
    INSERT INTO importazioni_linkedin (id, user_id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      user_id = excluded.user_id,
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);
  const now = nowIso();
  db.exec("BEGIN");
  try {
    importazioni.forEach((job) => {
      inserisci.run(job.id, job.userId, serializza(job), job.startedAt || now, now);
    });
    db.exec("COMMIT");
  } catch (errore) {
    db.exec("ROLLBACK");
    throw errore;
  }
}

function leggiImpostazioniAi() {
  const rows = db.prepare("SELECT payload FROM impostazioni_ai ORDER BY updated_at DESC").all();
  return rows.map((row) => parsePayload(row, {})).filter(Boolean);
}

function salvaImpostazioniAi(impostazioni) {
  const inserisci = db.prepare(`
    INSERT INTO impostazioni_ai (id, user_id, payload, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      payload = excluded.payload,
      updated_at = excluded.updated_at
  `);
  const now = nowIso();
  db.exec("BEGIN");
  try {
    impostazioni.forEach((record) => {
      inserisci.run(record.id || record.userId, record.userId, serializza(record), record.createdAt || now, now);
    });
    db.exec("COMMIT");
  } catch (errore) {
    db.exec("ROLLBACK");
    throw errore;
  }
}

function creaUtente(utente) {
  db.prepare(`
    INSERT INTO utenti (id, email, password_hash, nome, ruolo, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(utente.id, utente.email, utente.passwordHash, utente.nome, utente.ruolo, utente.createdAt, utente.updatedAt);
}

function trovaUtentePerEmail(email) {
  return db.prepare("SELECT * FROM utenti WHERE lower(email) = lower(?)").get(email) || null;
}

function trovaUtentePerId(id) {
  return db.prepare("SELECT * FROM utenti WHERE id = ?").get(id) || null;
}

function salvaSessione(sessione) {
  db.prepare(`
    INSERT INTO sessioni (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(sessione.id, sessione.userId, sessione.tokenHash, sessione.expiresAt, sessione.createdAt);
}

function trovaSessionePerHash(tokenHash) {
  return db.prepare("SELECT * FROM sessioni WHERE token_hash = ?").get(tokenHash) || null;
}

function eliminaSessionePerHash(tokenHash) {
  db.prepare("DELETE FROM sessioni WHERE token_hash = ?").run(tokenHash);
}

function listaUtentiAdmin() {
  return db.prepare(`
    SELECT
      u.id,
      u.email,
      u.nome,
      u.ruolo,
      u.created_at,
      COALESCE(c.totale_contatti, 0) AS totale_contatti,
      COALESCE(i.totale_importazioni, 0) AS totale_importazioni
    FROM utenti u
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS totale_contatti
      FROM contatti
      GROUP BY user_id
    ) c ON c.user_id = u.id
    LEFT JOIN (
      SELECT user_id, COUNT(*) AS totale_importazioni
      FROM importazioni_linkedin
      GROUP BY user_id
    ) i ON i.user_id = u.id
    ORDER BY u.created_at DESC
  `).all();
}

function riepilogoUtentiAdmin() {
  const totaleUtenti = db.prepare("SELECT COUNT(*) AS totale FROM utenti").get().totale;
  const totaleAdmin = db.prepare("SELECT COUNT(*) AS totale FROM utenti WHERE ruolo = 'admin'").get().totale;
  const totaleContatti = db.prepare("SELECT COUNT(*) AS totale FROM contatti").get().totale;
  const totaleImportazioni = db.prepare("SELECT COUNT(*) AS totale FROM importazioni_linkedin").get().totale;
  return {
    totaleUtenti,
    totaleAdmin,
    totaleContatti,
    totaleImportazioni
  };
}

function svuotaCartella(percorso) {
  if (!fs.existsSync(percorso)) {
    return;
  }
  fs.rmSync(percorso, { recursive: true, force: true });
}

module.exports = {
  cartellaDati,
  cartellaTemp,
  fileDatabase,
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
  riepilogoUtentiAdmin,
  svuotaCartella
};
