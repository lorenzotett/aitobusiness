const crypto = require("crypto");
const { randomUUID } = require("crypto");

const COOKIE_SESSIONE = "aito_session";
const DURATA_SESSIONE_MS = 1000 * 60 * 60 * 24 * 14;

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `${salt}:${derived}`;
}

function verificaPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || "").split(":");
  if (!salt || !hash) return false;
  const attempt = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(attempt, "hex"));
}

function generaTokenSessione() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashTokenSessione(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function creaCookieSessione(token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_SESSIONE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(DURATA_SESSIONE_MS / 1000)}${secure}`;
}

function creaCookieLogout() {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${COOKIE_SESSIONE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function leggiCookie(req, nome) {
  const raw = req.headers.cookie || "";
  const cookies = raw.split(";").map((item) => item.trim());
  const target = cookies.find((cookie) => cookie.startsWith(`${nome}=`));
  return target ? decodeURIComponent(target.slice(nome.length + 1)) : "";
}

function creaUtentePayload({ email, nome, password, ruolo = "utente" }) {
  const now = new Date().toISOString();
  return {
    id: randomUUID(),
    email: String(email || "").trim().toLowerCase(),
    nome: String(nome || "").trim() || "Utente",
    ruolo,
    passwordHash: hashPassword(password),
    createdAt: now,
    updatedAt: now
  };
}

function creaSessionePayload(userId, token) {
  return {
    id: randomUUID(),
    userId,
    tokenHash: hashTokenSessione(token),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + DURATA_SESSIONE_MS).toISOString()
  };
}

module.exports = {
  COOKIE_SESSIONE,
  hashPassword,
  verificaPassword,
  generaTokenSessione,
  hashTokenSessione,
  creaCookieSessione,
  creaCookieLogout,
  leggiCookie,
  creaUtentePayload,
  creaSessionePayload
};
