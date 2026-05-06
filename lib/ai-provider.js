const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

function creaChiaveCifratura() {
  const segretoAmbiente = process.env.APP_SECRET || process.env.AI_SETTINGS_SECRET || "";
  if (segretoAmbiente) {
    return crypto.createHash("sha256").update(segretoAmbiente).digest();
  }

  const cartellaDati = process.env.VERCEL ? path.join("/tmp", "aito-business-data") : path.join(__dirname, "..", "data");
  const fileSegreto = path.join(cartellaDati, ".app-secret");
  if (!fs.existsSync(cartellaDati)) {
    fs.mkdirSync(cartellaDati, { recursive: true });
  }
  if (!fs.existsSync(fileSegreto)) {
    fs.writeFileSync(fileSegreto, crypto.randomBytes(32).toString("hex"));
  }
  const segretoLocale = fs.readFileSync(fileSegreto, "utf8").trim();
  return crypto.createHash("sha256").update(segretoLocale).digest();
}

function cifraValore(valore) {
  const chiave = creaChiaveCifratura();
  if (!chiave || !valore) {
    return null;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", chiave, iv);
  const contenuto = Buffer.concat([cipher.update(valore, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${contenuto.toString("base64")}`;
}

function decifraValore(valoreCifrato) {
  const chiave = creaChiaveCifratura();
  if (!chiave || !valoreCifrato) {
    return null;
  }
  const [ivBase64, tagBase64, contenutoBase64] = valoreCifrato.split(".");
  if (!ivBase64 || !tagBase64 || !contenutoBase64) {
    return null;
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", chiave, Buffer.from(ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(tagBase64, "base64"));
  const output = Buffer.concat([decipher.update(Buffer.from(contenutoBase64, "base64")), decipher.final()]);
  return output.toString("utf8");
}

function mascheraChiaveApi(apiKey) {
  if (!apiKey) {
    return "";
  }
  if (apiKey.length <= 8) {
    return `${apiKey.slice(0, 2)}***`;
  }
  return `${apiKey.slice(0, 4)}***${apiKey.slice(-4)}`;
}

function normalizzaImpostazioniAi(payload = {}) {
  return {
    provider: payload.provider || "groq",
    modello: payload.modello || "llama-3.3-70b-versatile",
    endpoint: payload.endpoint || "https://api.groq.com/openai/v1/chat/completions",
    temperatura: Number.isFinite(Number(payload.temperatura)) ? Number(payload.temperatura) : 0.2,
    maxToken: Number.isFinite(Number(payload.maxToken)) ? Number(payload.maxToken) : 600,
    limiteCrediti: Number.isFinite(Number(payload.limiteCrediti)) ? Number(payload.limiteCrediti) : 120,
    creditiResidui: Number.isFinite(Number(payload.creditiResidui)) ? Number(payload.creditiResidui) : Number.isFinite(Number(payload.limiteCrediti)) ? Number(payload.limiteCrediti) : 120,
    creditiConsumati: Number.isFinite(Number(payload.creditiConsumati)) ? Number(payload.creditiConsumati) : 0
  };
}

function serializzaImpostazioniAiPerClient(record = {}) {
  return {
    provider: record.provider || "groq",
    modello: record.modello || "llama-3.3-70b-versatile",
    endpoint: record.endpoint || "https://api.groq.com/openai/v1/chat/completions",
    temperatura: record.temperatura ?? 0.2,
    maxToken: record.maxToken ?? 600,
    limiteCrediti: record.limiteCrediti ?? 120,
    creditiResidui: record.creditiResidui ?? 120,
    creditiConsumati: record.creditiConsumati ?? 0,
    chiaveConfigurata: Boolean(record.apiKeyEncrypted),
    apiKeyMasked: mascheraChiaveApi(record.apiKeyPreview || "")
  };
}

function tentaParseJsonAi(testo) {
  if (!testo || typeof testo !== "string") {
    return null;
  }
  try {
    return JSON.parse(testo);
  } catch (_errore) {
    const match = testo.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]);
    } catch (_erroreInterno) {
      return null;
    }
  }
}

async function chiamaProviderAi(configurazione, promptSistema, promptUtente) {
  const apiKey = decifraValore(configurazione.apiKeyEncrypted);
  if (!apiKey) {
    throw new Error("AI_KEY_MISSING");
  }

  const risposta = await fetch(configurazione.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: configurazione.modello,
      temperature: configurazione.temperatura,
      max_tokens: configurazione.maxToken,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: promptSistema },
        { role: "user", content: promptUtente }
      ]
    })
  });

  if (!risposta.ok) {
    const codice = risposta.status;
    const errore = new Error(codice === 429 ? "AI_RATE_LIMIT" : "AI_PROVIDER_ERROR");
    errore.status = codice;
    throw errore;
  }

  const payload = await risposta.json();
  const contenuto = payload?.choices?.[0]?.message?.content;
  const parsed = tentaParseJsonAi(typeof contenuto === "string" ? contenuto : JSON.stringify(contenuto));
  if (!parsed) {
    throw new Error("AI_PARSE_ERROR");
  }
  return parsed;
}

module.exports = {
  cifraValore,
  decifraValore,
  mascheraChiaveApi,
  normalizzaImpostazioniAi,
  serializzaImpostazioniAiPerClient,
  tentaParseJsonAi,
  chiamaProviderAi
};
