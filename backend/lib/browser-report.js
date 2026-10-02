const ROUTES = new Set(['profile', 'profil', 'packs', 'paquets', 'boosters', 'collection', 'login', 'connexion', 'auth', 'shop', 'boutique', 'play', 'game', 'dashboard']);
export function safeRoute(raw) {
  try {
    const path = new URL(raw, 'https://www.wiki-masters.com').pathname;
    const first = path.split('/')[1];
    return !first ? '/' : ROUTES.has(first) ? `/${first}${path.split('/').length > 2 ? '/[masqué]' : ''}` : 'other';
  } catch { return 'unknown'; }
}
export function publicResource(raw) {
  try {
    const u = new URL(raw);
    const path = u.pathname;
    const endpoint = ['/api/packs/open', '/api/wikibidous', '/auth/v1/user', '/auth/v1/token'].includes(path) ? path : null;
    return { origin: u.origin, endpoint, route: safeRoute(raw), resource: /captcha|turnstile|challenge|recaptcha|hcaptcha/i.test(path) ? 'verification' : /\/auth\//.test(path) ? 'authentication' : /\/rest\//.test(path) ? 'account_data' : endpoint ? 'site_api' : 'page_or_asset' };
  } catch { return { resource: 'unknown' }; }
}
export function reportFindings(report) {
  const states = report.timeline.filter(e => e.event === 'page_state');
  const last = states.at(-1);
  const findings = [];
  if (report.authentication?.accountMatch === true) findings.push({ code: 'account_confirmed', certainty: 'observed' });
  else if (report.authentication?.accountMatch === false) findings.push({ code: 'different_account', certainty: 'observed' });
  else findings.push({ code: 'account_not_confirmed', certainty: 'unknown' });
  if (report.authentication?.cookieCheck?.status === 401 || report.authentication?.cookieCheck?.status === 403) findings.push({ code: 'cookie_authentication_rejected', certainty: 'observed' });
  if (last?.loginFormVisible || last?.signInControlVisible) findings.push({ code: 'sign_in_ui_visible', certainty: 'observed' });
  if (states.some(e => e.visibleButtonCount > (states[0]?.visibleButtonCount || 0))) findings.push({ code: 'interface_changed_after_document_load', certainty: 'observed' });
  if (report.opening?.reason) findings.push({ code: report.opening.reason, certainty: 'observed' });
  const relevantFailures = (report.failures || []).filter(f => f.interpretation !== 'expected_nonfatal_dns_probe');
  if (relevantFailures.length) findings.push({ code: 'network_failures', certainty: 'observed', count: relevantFailures.length });
  if (report.networkDiagnostic?.https?.ok === true) findings.push({ code: 'cloudflare_script_reachable_from_server', certainty: 'observed' });
  for (const code of new Set((report.consoleErrors || []).map(e => e.turnstileCode).filter(Boolean))) findings.push({ code: 'turnstile_error_code', value: code, certainty: 'observed' });
  if (report.pageErrors?.length) findings.push({ code: 'javascript_errors', certainty: 'observed', count: report.pageErrors.length });
  if (last?.verificationVisible) findings.push({ code: 'verification_visible', certainty: 'observed' });
  return findings;
}
