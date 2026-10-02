import { publicResource, safeRoute, reportFindings } from './browser-report.js';
import { jwtPayload } from './security.js';
import { waitForOpeningButton } from './button-wait.js';
import { chromium } from 'playwright';
import { SITE_URL } from './config.js';
import { captchaDiagnostic } from './captcha.js';
import { buildWikiCookie } from './wiki.js';

export async function probeBrowser(session, { tryOpen = false } = {}) {
  const report = { schemaVersion: 3, kind: 'browser_probe', backendVersion: '0.5.14', capturedAt: new Date().toISOString(), mode: 'standard_headless_chromium', outcome: 'starting', requests: [], failures: [], pageErrors: [], verification: null, note: 'Chargement uniquement : aucun clic sur un CAPTCHA ou un bouton d’ouverture, aucun cookie ou jeton exporté.' };
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  report.timeline = [];
  const expectedAccount = session.user?.id || jwtPayload(session.access_token)?.sub || null;
  const expiresAt = Number(session.expires_at || jwtPayload(session.access_token)?.exp || 0);
  report.authentication = { accessTokenPresent: Boolean(session.access_token), refreshTokenPresent: Boolean(session.refresh_token), expiresInSeconds: expiresAt ? Math.round(expiresAt - Date.now() / 1000) : null, accountMatch: null, cookieCheck: null };
  report.consoleErrors = [];
  report.truncated = { requests: false, timeline: false };
  report.limits = { buttonWaitMs: 15000, observationMs: 25000 };
  const event = (name, details = {}) => { if (report.timeline.length < 100) report.timeline.push({ elapsedMs: elapsed(), event: name, ...details }); else report.truncated.timeline = true; };
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    event('browser_ready');
    const context = await browser.newContext();
    await context.addCookies(buildWikiCookie(session).split('; ').map(part => {
      const eq = part.indexOf('=');
      return { name: part.slice(0, eq), value: part.slice(eq + 1), url: SITE_URL, secure: true, sameSite: 'Lax' };
    }));
    report.authentication.injectedCookieCount = (await context.cookies(SITE_URL)).length;
    const page = await context.newPage();
    report.runtime = { chromiumVersion: browser.version(), viewport: page.viewportSize() };
    page.on('console', message => {
      if (!['error', 'warning'].includes(message.type()) || report.consoleErrors.length >= 20) return;
      report.consoleErrors.push({ elapsedMs: elapsed(), level: message.type(), category: /cors|cross.origin/i.test(message.text()) ? 'cors' : /network|fetch|load|resource/i.test(message.text()) ? 'resource_loading' : 'other' });
    });
    const pendingRequests = new Set();
    page.on('request', request => pendingRequests.add(request));
    page.on('requestfinished', request => pendingRequests.delete(request));
    page.on('requestfailed', request => pendingRequests.delete(request));
    let openingResult = null;
    const responseTasks = [];
    report.opening = { requested: tryOpen, clicked: false, responses: [] };
    page.on('response', response => {
      if (new URL(response.url()).pathname === '/auth/v1/user' && /\.supabase\.co$/.test(new URL(response.url()).hostname)) {
        responseTasks.push((async () => {
          report.authentication.userEndpointStatus = response.status();
          if (response.ok()) {
            const body = await response.json();
            const id = body.id || body.user?.id;
            if (id && expectedAccount) report.authentication.accountMatch = id === expectedAccount;
          }
          event('account_response', { status: response.status(), accountMatch: report.authentication.accountMatch });
        })().catch(() => {}));
      }
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
      if (report.requests.length < 100) report.requests.push({ elapsedMs: elapsed(), ...publicResource(response.url()), status: response.status(), method: response.request().method(), timing: response.request().timing(), type: response.request().resourceType() }); else report.truncated.requests = true;
    });
    page.on('requestfailed', request => {
      if (report.failures.length < 20) report.failures.push({ elapsedMs: elapsed(), ...publicResource(request.url()), method: request.method(), type: request.resourceType(), reason: request.failure()?.errorText?.replace(/https?:\/\/\S+/g, '[URL]') || 'failed' });
    });
    page.on('pageerror', error => {
      if (report.pageErrors.length < 20) report.pageErrors.push({ elapsedMs: elapsed(), name: error.name, category: /network|fetch|load/i.test(error.message) ? 'resource_loading' : 'javascript_error' });
    });
    const snapshot = async (phase) => {
      const state = await page.evaluate(() => {
        const visible = el => Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
        const clean = text => String(text || '').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.\w+|[A-Za-z0-9_-]{30,}/g, '[masqué]').replace(/\s+/g, ' ').trim().slice(0, 100);
        const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
        const visibleButtons = buttons.slice(0, 24).map(el => ({ label: clean(el.getAttribute('aria-label') || el.innerText), disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' }));
        const links = [...document.querySelectorAll('a[href]')].filter(visible).slice(0, 30).map(el => { const u = new URL(el.href, location.href); const first = u.pathname.split('/')[1]; const allowed = ['profile','profil','packs','boosters','collection','login','connexion','auth','shop','boutique','play','game','dashboard']; return { label: clean(el.getAttribute('aria-label') || el.innerText), sameOrigin: u.origin === location.origin, route: u.pathname === '/' ? '/' : allowed.includes(first) ? '/' + first : 'other' }; });
        const openingButtons = buttons.filter(el => /ouvrir|open|booster|paquet|pack/i.test(el.innerText + ' ' + el.getAttribute('aria-label'))).slice(0, 12).map(el => ({ label: clean(el.getAttribute('aria-label') || el.innerText), disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' }));
        return { visibleButtons, links, challengeFrameCount: [...document.querySelectorAll('iframe')].filter(el => visible(el) && /captcha|turnstile|challenge/i.test(el.src + el.title)).length, dialogCount: [...document.querySelectorAll('dialog,[role="dialog"]')].filter(visible).length, loadingIndicatorVisible: Boolean(document.querySelector('[aria-busy="true"],[role="progressbar"]')), signInControlVisible: buttons.some(el => /^(se connecter|connexion|sign in|log in)$/i.test(el.innerText.trim())), signOutControlVisible: buttons.some(el => /déconnexion|se déconnecter|sign out|log out/i.test(el.innerText)), readyState: document.readyState, visibleButtonCount: buttons.length, openingButtons, verificationVisible: /vérification rapide|verification rapide|anti.bot|verify you are human/i.test(document.body.innerText), loginFormVisible: [...document.querySelectorAll('input[type="password"]')].some(visible) };
      });
      const path = new URL(page.url()).pathname;
      event('page_state', { phase, route: safeRoute(page.url()), pendingRequestCount: pendingRequests.size, ...state });
      return state;
    };
    page.on('domcontentloaded', () => event('domcontentloaded'));
    page.on('load', () => event('load'));
    event('navigation_start');
    const response = await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    report.documentStatus = response?.status() || null;
    event('navigation_complete', { status: report.documentStatus, route: safeRoute(page.url()) });
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
    event('cookie_authentication_check_start');
    report.authentication.cookieCheck = await page.evaluate(async () => {
      try {
        const r = await fetch('/api/wikibidous', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(5000) });
        return { status: r.status, ok: r.ok, contentType: (r.headers.get('content-type') || '').split(';')[0] };
      } catch { return { status: null, ok: false, error: 'network_or_timeout' }; }
    });
    event('cookie_authentication_check_finished', report.authentication.cookieCheck);
    await snapshot('after_authentication_check');
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
    await Promise.allSettled(responseTasks);
    await snapshot('final_page');
    report.pendingRequestCount = pendingRequests.size;
    report.authentication.finalCookieCount = (await context.cookies(SITE_URL)).length;
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
    report.findings = reportFindings(report);
    report.durationMs = elapsed();
    report.completedAt = new Date().toISOString();
    event('finished', { outcome: report.outcome });
  }
  return report;
}
