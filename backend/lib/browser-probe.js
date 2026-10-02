import { chromium } from 'playwright';
import { SITE_URL } from './config.js';
import { captchaDiagnostic } from './captcha.js';
import { buildWikiCookie } from './wiki.js';

function publicUrl(raw) {
  try {
    const url = new URL(raw);
    // Exclude paths and queries that may contain account IDs or verification tokens.
    return { origin: url.origin, resource: /captcha|turnstile|challenge|recaptcha|hcaptcha/i.test(url.pathname) ? 'verification' : 'page_or_asset' };
  } catch { return null; }
}

export async function probeBrowser(session, { tryOpen = false } = {}) {
  const report = { schemaVersion: 1, kind: 'browser_probe', backendVersion: '0.5.12', capturedAt: new Date().toISOString(), mode: 'standard_headless_chromium', outcome: 'starting', requests: [], failures: [], pageErrors: [], verification: null, note: 'Chargement uniquement : aucun clic sur un CAPTCHA ou un bouton d’ouverture, aucun cookie ou jeton exporté.' };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const context = await browser.newContext();
    await context.addCookies(buildWikiCookie(session).split('; ').map(part => {
      const eq = part.indexOf('=');
      return { name: part.slice(0, eq), value: part.slice(eq + 1), url: SITE_URL, secure: true, sameSite: 'Lax' };
    }));
    const page = await context.newPage();
    let openingResult = null;
    const responseTasks = [];
    report.opening = { requested: tryOpen, clicked: false, responses: [] };
    page.on('response', response => {
      if (!tryOpen || new URL(response.url()).origin !== SITE_URL || new URL(response.url()).pathname !== '/api/packs/open') return;
      responseTasks.push((async () => {
        const text = await response.text();
        const diagnostic = captchaDiagnostic({ status: response.status(), statusText: response.statusText(), ok: response.ok(), redirected: false, headers: new Headers(await response.allHeaders()) }, text, '/api/packs/open', 'POST', true);
        report.opening.responses.push({ status: response.status(), diagnostic });
        if (response.ok()) {
          const body = JSON.parse(text);
          if (Array.isArray(body.cards)) openingResult = { session, packsOpened: 1, packsRemaining: body.packs_remaining ?? null, cards: body.cards.map(card => ({ cardId: card.id || null, title: card.wikipedia_title || card.title || 'Carte', wikipediaUrl: card.wikipedia_url || null, imageUrl: card.image_url || null, category: card.category || null, rarity: String(card.rarity || 'C').toUpperCase(), atk: card.atk ?? null, def: card.def ?? null, pulledAt: Date.now() })) };
        }
      })().catch(() => { report.opening.responseReadFailed = true; }));
    });
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
    if (tryOpen) {
      report.note = 'Un seul clic sur le bouton d’ouverture du site. Observation de la vérification automatique sans interaction avec le CAPTCHA. Aucun cookie ou jeton exporté.';
      const button = page.getByRole('button', { name: /^(ouvrir|open)\s+(un\s+|1\s+|a\s+)?(booster|paquet|pack)(?:\s|$)/i }).filter({ visible: true }).first();
      if (await button.count() && await button.isEnabled()) {
        report.opening.clicked = true;
        await button.click({ timeout: 5000 });
        for (let i = 0; i < 25 && !openingResult; i++) await page.waitForTimeout(1000);
        await Promise.allSettled(responseTasks);
      } else report.opening.reason = 'opening_button_not_found_or_disabled';
    }
    report.verification = await page.evaluate(() => ({
      visiblePrompt: /vérification rapide|verification rapide|anti.bot|verify you are human/i.test(document.body.innerText),
      scriptProviders: [...document.scripts].map(s => s.src).filter(src => /turnstile|captcha|recaptcha|hcaptcha/i.test(src)).map(src => { try { return new URL(src).hostname; } catch { return 'unknown'; } }),
      challengeFrameCount: [...document.querySelectorAll('iframe')].filter(frame => /captcha|turnstile|challenge/i.test(frame.src + frame.title)).length,
      loginFormVisible: Boolean(document.querySelector('input[type="password"]'))
    }));
    report.outcome = report.verification.visiblePrompt || report.verification.challengeFrameCount ? 'verification_detected_stopped' : report.verification.loginFormVisible ? 'login_required' : 'page_loaded';
    if (tryOpen) {
      report.outcome = openingResult ? 'booster_opened' : !report.opening.clicked ? 'opening_button_unavailable' : report.verification.visiblePrompt || report.verification.challengeFrameCount ? 'verification_detected_stopped' : 'opening_not_confirmed';
      if (openingResult) Object.defineProperty(report, 'openingResult', { value: openingResult, enumerable: false });
    }
  } catch (error) {
    report.outcome = 'browser_error';
    report.error = { name: error.name, category: /shared libraries|lib[^ ]+\.so/i.test(error.message) ? 'missing_system_library' : /executable.*exist/i.test(error.message) ? 'missing_browser_binary' : /executable|launch/i.test(error.message) ? 'browser_launch' : /timeout/i.test(error.message) ? 'timeout' : 'navigation_or_runtime' };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
  return report;
}
