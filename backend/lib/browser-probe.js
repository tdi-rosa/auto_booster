import { waitForOpeningButton } from './button-wait.js';
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
  const report = { schemaVersion: 2, kind: 'browser_probe', backendVersion: '0.5.13', capturedAt: new Date().toISOString(), mode: 'standard_headless_chromium', outcome: 'starting', requests: [], failures: [], pageErrors: [], verification: null, note: 'Chargement uniquement : aucun clic sur un CAPTCHA ou un bouton d’ouverture, aucun cookie ou jeton exporté.' };
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  report.timeline = [];
  report.limits = { buttonWaitMs: 15000, observationMs: 25000 };
  const event = (name, details = {}) => { if (report.timeline.length < 100) report.timeline.push({ elapsedMs: elapsed(), event: name, ...details }); };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    event('browser_ready');
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
        event('opening_response', { status: response.status() });
        report.opening.responses.push({ elapsedMs: elapsed(), status: response.status(), diagnostic });
        if (response.ok()) {
          const body = JSON.parse(text);
          if (Array.isArray(body.cards)) openingResult = { session, packsOpened: 1, packsRemaining: body.packs_remaining ?? null, cards: body.cards.map(card => ({ cardId: card.id || null, title: card.wikipedia_title || card.title || 'Carte', wikipediaUrl: card.wikipedia_url || null, imageUrl: card.image_url || null, category: card.category || null, rarity: String(card.rarity || 'C').toUpperCase(), atk: card.atk ?? null, def: card.def ?? null, pulledAt: Date.now() })) };
        }
      })().catch(() => { report.opening.responseReadFailed = true; }));
    });
    page.on('response', response => {
      if (report.requests.length < 100) report.requests.push({ elapsedMs: elapsed(), ...publicUrl(response.url()), status: response.status(), type: response.request().resourceType() });
    });
    page.on('requestfailed', request => {
      if (report.failures.length < 20) report.failures.push({ elapsedMs: elapsed(), ...publicUrl(request.url()), reason: request.failure()?.errorText?.replace(/https?:\/\/\S+/g, '[URL]') || 'failed' });
    });
    page.on('pageerror', error => {
      if (report.pageErrors.length < 20) report.pageErrors.push({ elapsedMs: elapsed(), name: error.name, category: /network|fetch|load/i.test(error.message) ? 'resource_loading' : 'javascript_error' });
    });
    const snapshot = async (phase) => {
      const state = await page.evaluate(() => {
        const visible = el => Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
        const clean = text => String(text || '').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.\w+|[A-Za-z0-9_-]{30,}/g, '[masqué]').replace(/\s+/g, ' ').trim().slice(0, 100);
        const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
        const openingButtons = buttons.filter(el => /ouvrir|open|booster|paquet|pack/i.test(el.innerText + ' ' + el.getAttribute('aria-label'))).slice(0, 12).map(el => ({ label: clean(el.getAttribute('aria-label') || el.innerText), disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' }));
        return { readyState: document.readyState, visibleButtonCount: buttons.length, openingButtons, verificationVisible: /vérification rapide|verification rapide|anti.bot|verify you are human/i.test(document.body.innerText), loginFormVisible: [...document.querySelectorAll('input[type="password"]')].some(visible) };
      });
      const path = new URL(page.url()).pathname;
      event('page_state', { phase, route: /^\/(packs|profile|profil)(?:\/|$)/.test(path) ? path.split('/').slice(0, 2).join('/') : path === '/' ? '/' : 'other', ...state });
      return state;
    };
    page.on('domcontentloaded', () => event('domcontentloaded'));
    page.on('load', () => event('load'));
    event('navigation_start');
    const response = await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    report.documentStatus = response?.status() || null;
    await snapshot('initial_document');
    let route = null;
    for (let i = 0; i < 6 && !route; i++) {
      route = await page.locator('a[href]').evaluateAll(links => {
        const routes = links.map(a => a.getAttribute('href')).filter(href => /^\/(packs|profile|profil)(?:\/|$)/.test(href || ''));
        return routes.find(href => /^\/packs(?:\/|$)/.test(href)) || routes[0] || null;
      });
      if (!route) await page.waitForTimeout(1000);
    }
    event('route_discovery', { found: Boolean(route) });
    if (route) await page.goto(new URL(route, SITE_URL).href, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(2500);
    if (tryOpen) {
      report.note = 'Un seul clic sur le bouton d’ouverture du site. Observation de la vérification automatique sans interaction avec le CAPTCHA. Aucun cookie ou jeton exporté.';
      const button = page.getByRole('button', { name: /^(ouvrir|open)\s+(un\s+|le\s+|1\s+|a\s+|the\s+)?(booster|paquet|pack)(?:\s|$)/i }).filter({ visible: true }).first();
      event('button_wait_start');
      const { ready, seen, waitedMs } = await waitForOpeningButton({
        button, snapshot, now: elapsed, sleep: ms => page.waitForTimeout(ms), timeoutMs: report.limits.buttonWaitMs
      });
      report.opening.buttonWaitMs = waitedMs;
      if (ready) {
        event('button_ready');
        await button.click({ timeout: 5000 });
        report.opening.clicked = true;
        event('button_clicked');
        const observeStarted = elapsed();
        while (elapsed() - observeStarted < report.limits.observationMs && !openingResult) {
          await snapshot('after_click');
          await page.waitForTimeout(1000);
        }
        await Promise.allSettled(responseTasks);
        event('observation_finished', { confirmed: Boolean(openingResult) });
      } else {
        report.opening.reason = seen ? 'opening_button_disabled' : 'opening_button_not_found';
        event('button_wait_finished', { reason: report.opening.reason });
      }
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
    report.durationMs = elapsed();
    report.completedAt = new Date().toISOString();
    event('finished', { outcome: report.outcome });
  }
  return report;
}
