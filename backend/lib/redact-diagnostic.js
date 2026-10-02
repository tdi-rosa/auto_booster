export function redactDiagnostic(text, secrets = []) {
  let value = String(text || '');
  for (const secret of secrets.filter(s => typeof s === 'string' && s.length >= 4).sort((a, b) => b.length - a.length)) value = value.split(secret).join('[masqué]');
  return value
    .replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [masqué]')
    .replace(/(["']?(?:access_token|refresh_token|token|password|authorization|cookie|apikey|api_key|sitekey|cdata)["']?\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;}]+)/gi, '$1[masqué]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[URL masquée]')
    .replace(/[\w.+-]+@[\w.-]+\.\w+/g, '[adresse masquée]')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[identifiant masqué]')
    .replace(/\b[A-Za-z0-9_+\/-]{24,}(?:\.[A-Za-z0-9_+\/-]+)*={0,2}\b/g, '[valeur masquée]')
    .slice(0, 800);
}
