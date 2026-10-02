// Deliberately allowlisted metadata: never persist raw bodies, cookies or tokens.
export function isCaptchaMessage(value) {
  const normalized = String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /captcha|turnstile|anti[ _-]?bot|human[ _-](verification|required)|verification[ _-](humaine|requise)|bot[ _-]detected|challenge[ _-]required/i.test(normalized);
}

export function captchaDiagnostic(response, text, endpoint, method = "POST", force = false) {
  let body;
  try { body = JSON.parse(text); } catch {}
  const fields = [body?.error, body?.code, body?.error_code, body?.message, body?.msg];
  const signals = text;
  const htmlChallenge = /(?:cf-turnstile|g-recaptcha|h-captcha|challenges.cloudflare.com|captcha)/i.test(text);
  if (!force && !isCaptchaMessage(signals)
      && !(response.status >= 400 && htmlChallenge)
      && response.headers.get("cf-mitigated") !== "challenge") return null;
  const provider = /turnstile|challenges.cloudflare.com/i.test(text) ? "Cloudflare Turnstile"
    : /hcaptcha|h-captcha/i.test(text) ? "hCaptcha"
    : /recaptcha/i.test(text) ? "reCAPTCHA" : "inconnu";
  const knownCodes = fields.filter(value => typeof value === "string" && /^[a-z][a-z0-9_-]{0,79}$/i.test(value));
  const hosts = [...text.matchAll(/https:\/\/([a-z0-9.-]+)(?:[/:"'\s]|$)/gi)]
    .map(match => match[1]).filter(host => /(?:^|\.)(?:google\.com|gstatic\.com|recaptcha\.net|hcaptcha\.com|cloudflare\.com)$/.test(host));
  return {
    schemaVersion: 2,
    backendVersion: "0.5.8",
    capturedAt: new Date().toISOString(), endpoint, method,
    kind: isCaptchaMessage(signals) || htmlChallenge ? "captcha" : "http_error",
    statusText: response.statusText,
    redirected: response.redirected,
    responseHeaders: Object.fromEntries(["content-type", "server", "cf-mitigated", "cf-ray", "retry-after", "x-request-id", "x-correlation-id"].map(key => [key, response.headers.get(key)]).filter(([,value]) => value !== null)),
    responseStructure: responseStructure(body),
    publicMessages: publicMessages(body),
    htmlIndicators: ["captcha", "turnstile", "recaptcha", "hcaptcha", "challenge", "anti-bot"].filter(marker => text.toLowerCase().includes(marker)),
    httpStatus: response.status, provider,
    contentType: response.headers.get("content-type")?.split(";")[0] || null,
    cloudflareChallenge: response.headers.get("cf-mitigated") === "challenge",
    errorCodes: [...new Set(knownCodes)],
    responseKeys: body && typeof body === "object" ? Object.keys(body).filter(key => /^[a-z0-9_-]{1,60}$/i.test(key)).slice(0, 40) : [],
    challengeHosts: [...new Set(hosts)].slice(0, 10),
    responseBytes: Buffer.byteLength(text),
    note: "Métadonnées uniquement. Aucun cookie, jeton, identifiant ou corps brut conservé."
  };
}

export class CaptchaRequiredError extends Error {
  constructor(diagnostic) {
    super("Vérification CAPTCHA nécessaire : Auto Opener désactivé. Valide la vérification sur WikiMasters puis réactive-le manuellement.");
    this.name = "CaptchaRequiredError";
    this.diagnostic = diagnostic;
  }
}


function responseStructure(value, depth = 0) {
  if (depth > 5) return "depth_limit";
  if (Array.isArray(value)) return { type: "array", length: value.length, sample: value.slice(0, 2).map(item => responseStructure(item, depth + 1)) };
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 60).filter(([key]) => /^[a-z0-9_-]{1,60}$/i.test(key)).map(([key, item]) => [key, responseStructure(item, depth + 1)]));
  return value === null ? "null" : typeof value;
}
function publicMessages(body) {
  const output = [];
  function visit(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 4) return;
    for (const [key, item] of Object.entries(value).slice(0, 60)) {
      // Only error messages containing recognized verification language are retained.
      if (/^(error|message|msg|error_description|detail|reason)$/i.test(key) && typeof item === "string" && isCaptchaMessage(item)) {
        output.push(item.slice(0, 1000)
          .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi, "[email masqué]")
          .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL masquée]")
          .replace(/(?:Bearer\s+)?[a-z0-9_+\/=-]{24,}/gi, "[valeur longue masquée]"));
      } else if (typeof item === "object") visit(item, depth + 1);
    }
  }
  visit(body);
  return output.slice(0, 10);
}
