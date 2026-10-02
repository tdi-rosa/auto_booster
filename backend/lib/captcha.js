// Deliberately allowlisted metadata: never persist raw bodies, cookies or tokens.
export function captchaDiagnostic(response, text, endpoint, method = "POST") {
  let body;
  try { body = JSON.parse(text); } catch {}
  const fields = [body?.error, body?.code, body?.error_code, body?.message, body?.msg];
  const signals = fields.filter(value => typeof value === "string").join(" ");
  const htmlChallenge = /(?:cf-turnstile|g-recaptcha|h-captcha|challenges.cloudflare.com|captcha)/i.test(text);
  if (!/captcha|turnstile|human.verification|human.required|bot.detected|challenge.required/i.test(signals)
      && !(response.status >= 400 && htmlChallenge)
      && response.headers.get("cf-mitigated") !== "challenge") return null;
  const provider = /turnstile|challenges.cloudflare.com/i.test(text) ? "Cloudflare Turnstile"
    : /hcaptcha|h-captcha/i.test(text) ? "hCaptcha"
    : /recaptcha/i.test(text) ? "reCAPTCHA" : "inconnu";
  const knownCodes = fields.filter(value => typeof value === "string" && /^[a-z][a-z0-9_-]{0,79}$/i.test(value));
  const hosts = [...text.matchAll(/https:\/\/([a-z0-9.-]+)(?:[/:"'\s]|$)/gi)]
    .map(match => match[1]).filter(host => /(?:^|\.)(?:google\.com|gstatic\.com|recaptcha\.net|hcaptcha\.com|cloudflare\.com)$/.test(host));
  return {
    capturedAt: new Date().toISOString(), endpoint, method,
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
