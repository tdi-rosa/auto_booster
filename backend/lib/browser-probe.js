import { chromium } from 'playwright';
import { SITE_URL } from './config.js';
import { buildWikiCookie } from './wiki.js';

function publicUrl(raw) {
  try {
    const url = new URL(raw);
    // Exclude paths and queries that may contain account IDs or verification tokens.
    return { origin: url.origin, resource: /captcha|turnstile|challenge|recaptcha|hcaptcha/i.test(url.pathname) ? 'verification' : 'page_or_asset' };
  } catch { return null; }
}

export async function probeBrowser(session) {
  const report = { schemaVersion: 1, kind: 'browser_probe', backendVersion: '0.5.11', capturedAt: new Date().toISOString(), mode: 'standard_headless_chromium', outcome: 'starting', requests: [], failures: [], pageErrors: [], verification: null, note: 'Chargement uniquement : aucun clic sur un CAPTCHA ou un bouton d’ouverture, aucun cookie ou jeton exporté.' };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext();
    await context.addCookies(buildWikiCookie(session).split('; ').map(part => {
      const eq = part.indexOf('=');
      return { name: part.slice(0, eq), value: part.slice(eq + 1), url: SITE_URL, secure: true, sameSite: 'Lax' };
    }));
    const page = await context.newPage();
    page.on('response', response => {
      if (report.requests.length < 60) report.requests.push({ ...publicUrl(response.url()), status: response.status(), type: response.request().resourceType() });
    });
    page.on('requestfailed', request => {
      if (report.failures.length < 20) report.failures.push({ ...publicUrl(request.url()), reason: request.failure()?.errorText?.replace(/https?:\/\/\S+/g, '[URL]') || 'failed' });
    });
    page.on('pageerror', error => {
      if (report.pageErrors.length < 20) report.pageErrors.push({ name: error.name, category: /network|fetch|load/i.test(error.message) ? 'resource_loading' : 'javascript_error' });
    });
    const response = await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    report.documentStatus = response?.status() || null;
    const route = await page.locator('a[href]').evaluateAll(links => links.map(a => a.getAttribute('href')).find(href => /^\/(packs|profile|profil)(?:\/|$)/.test(href || '')) || null);
    if (route) await page.goto(new URL(route, SITE_URL).href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2500);
    report.verification = await page.evaluate(() => ({
      visiblePrompt: /vérification rapide|verification rapide|anti.bot|verify you are human/i.test(document.body.innerText),
      scriptProviders: [...document.scripts].map(s => s.src).filter(src => /turnstile|captcha|recaptcha|hcaptcha/i.test(src)).map(src => { try { return new URL(src).hostname; } catch { return 'unknown'; } }),
      challengeFrameCount: [...document.querySelectorAll('iframe')].filter(frame => /captcha|turnstile|challenge/i.test(frame.src + frame.title)).length,
      loginFormVisible: Boolean(document.querySelector('input[type="password"]'))
    }));
    report.outcome = report.verification.visiblePrompt || report.verification.challengeFrameCount ? 'verification_detected_stopped' : report.verification.loginFormVisible ? 'login_required' : 'page_loaded';
  } catch (error) {
    report.outcome = 'browser_error';
    report.error = { name: error.name, category: /shared libraries|lib[^ ]+\.so/i.test(error.message) ? 'missing_system_library' : /executable.*exist/i.test(error.message) ? 'missing_browser_binary' : /executable|launch/i.test(error.message) ? 'browser_launch' : /timeout/i.test(error.message) ? 'timeout' : 'navigation_or_runtime' };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return report;
}
