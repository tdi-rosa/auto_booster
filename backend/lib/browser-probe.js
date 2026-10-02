import { logBrowserDiagnostic } from './diagnostic-log.js';
import { redactDiagnostic } from './redact-diagnostic.js';
import { networkDiagnostic, isNonFatalDnsProbe } from './network-diagnostic.js';
import { findPackLink } from './pack-navigation.js';
import { publicResource, safeRoute, reportFindings } from './browser-report.js';
import { jwtPayload } from './security.js';
import { waitForOpeningButton } from './button-wait.js';
import { chromium } from 'playwright';
import { SITE_URL } from './config.js';
import { captchaDiagnostic } from './captcha.js';
import { buildWikiCookie } from './wiki.js';

export async function probeBrowser(session, { tryOpen = false, engine = 'playwright' } = {}) {
  const report = { schemaVersion: 3, kind: 'browser_probe', backendVersion: '0.5.21', capturedAt: new Date().toISOString(), mode: 'standard_headless_chromium', outcome: 'starting', requests: [], failures: [], pageErrors: [], verification: null, note: 'Chargement uniquement : aucun clic sur un CAPTCHA ou un bouton d’ouverture, aucun cookie ou jeton exporté.' };
  report.engine = engine;
  const experimental = engine.startsWith('patchright');
  const channel = engine.startsWith('patchright-chrome') ? 'chrome' : undefined;
  const headless = engine !== 'patchright-chrome-headed';
  report.mode = experimental ? `experimental_${engine}_${headless ? 'headless' : 'headed'}` : 'standard_headless_chromium';
  report.browserConfiguration = { channel: channel || 'chromium', headless, virtualDisplay: !headless && Boolean(process.env.DISPLAY) };
  report.consoleCaptureAvailable = !experimental;
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  report.timeline = [];
  const expectedAccount = session.user?.id || jwtPayload(session.access_token)?.sub || null;
  const expiresAt = Number(session.expires_at || jwtPayload(session.access_token)?.exp || 0);
  report.authentication = { accessTokenPresent: Boolean(session.access_token), refreshTokenPresent: Boolean(session.refresh_token), expiresInSeconds: expiresAt ? Math.round(expiresAt - Date.now() / 1000) : null, accountMatch: null, cookieCheck: null };
  report.consoleErrors = [];
  const secrets = [session.access_token, session.refresh_token, session.user?.id, session.user?.email, expectedAccount, ...buildWikiCookie(session).split('; ').map(part => part.slice(part.indexOf('=') + 1))];
  const redact = text => redactDiagnostic(text, secrets);
  report.truncated = { requests: false, timeline: false };
  report.limits = { buttonWaitMs: 15000, observationMs: 25000 };
  const event = (name, details = {}) => { if (report.timeline.length < 100) report.timeline.push({ elapsedMs: elapsed(), event: name, ...details }); else report.truncated.timeline = true; };
  const networkCheck = networkDiagnostic();
  let browser;
  try {
    const browserType = experimental ? (await import('patchright')).chromium : chromium;
    browser = await browserType.launch({ headless, ...(channel ? { channel } : {}), args: ['--no-sandbox', '--disable-dev-shm-usage'] });
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
      if (!['error', 'warning'].includes(message.type()) || report.consoleErrors.length >= 50) return;
      const turnstileCode = /turnstile|cloudflare/i.test(message.text()) ? message.text().match(/\b[1-9]\d{5}\b/)?.[0] || null : null;
      report.consoleErrors.push({ message: redact(message.text()), source: publicResource(message.location().url), turnstileCode, elapsedMs: elapsed(), level: message.type(), category: /cors|cross.origin/i.test(message.text()) ? 'cors' : /network|fetch|load|resource/i.test(message.text()) ? 'resource_loading' : 'other' });
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
      if (report.failures.length < 20) report.failures.push({ elapsedMs: elapsed(), ...publicResource(request.url()), method: request.method(), type: request.resourceType(), interpretation: isNonFatalDnsProbe(request.url(), request.failure()?.errorText) ? 'expected_nonfatal_dns_probe' : 'unclassified_network_failure', reason: request.failure()?.errorText?.replace(/https?:\/\/\S+/g, '[URL]') || 'failed' });
    });
    page.on('pageerror', error => {
      if (report.pageErrors.length < 20) report.pageErrors.push({ message: redact(error.message), elapsedMs: elapsed(), name: error.name, category: /network|fetch|load/i.test(error.message) ? 'resource_loading' : 'javascript_error' });
    });
    const snapshot = async (phase) => {
      const state = await page.evaluate(() => {
        const visible = el => Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
        const clean = text => String(text || '').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.\w+|[A-Za-z0-9_-]{30,}/g, '[masqué]').replace(/\s+/g, ' ').trim().slice(0, 100);
        const buttons = [...document.querySelectorAll('button,[role="button"]')].filter(visible);
        const visibleButtons = buttons.slice(0, 24).map(el => ({ label: clean(el.getAttribute('aria-label') || el.innerText), disabled: el.matches(':disabled') || el.getAttribute('aria-disabled') === 'true' }));
        const links = [...document.querySelectorAll('a[href]')].filter(visible).slice(0, 30).map(el => { const u = new URL(el.href, location.href); const first = u.pathname.split('/')[1]; const allowed = ['profile','profil','packs','paquets','boosters','collection','login','connexion','auth','shop','boutique','play','game','dashboard']; return { label: clean(el.getAttribute('aria-label') || el.innerText), sameOrigin: u.origin === location.origin, route: u.pathname === '/' ? '/' : allowed.includes(first) ? '/' + first : 'other' }; });
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
    report.compatibility = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      let webglAvailable = false;
      try { webglAvailable = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch {}
      let sessionStorageAvailable = false;
      try { const key = '__wma_check_' + crypto.randomUUID(); sessionStorage.setItem(key, '1'); sessionStorageAvailable = sessionStorage.getItem(key) === '1'; sessionStorage.removeItem(key); } catch {}
      return { cookiesEnabled: navigator.cookieEnabled, sessionStorageAvailable, webglAvailable, webAssemblyAvailable: typeof WebAssembly !== 'undefined', secureContext: isSecureContext, userAgent: navigator.userAgent, browserAutomationReported: navigator.webdriver };
    });
    await snapshot('initial_document');
    let route = null;
    for (let i = 0; i < 6 && !route; i++) {
      const links = await page.locator('a[href]').evaluateAll(elements => elements.map(el => ({
        label: el.getAttribute('aria-label') || el.innerText,
        href: el.getAttribute('href'),
        visible: Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden'
      })));
      route = findPackLink(links, SITE_URL);
      if (!route) await page.waitForTimeout(1000);
    }
    report.navigation = { target: 'Paquets', found: Boolean(route), source: 'visible_navigation_link', reached: false };
    event('route_discovery', { found: Boolean(route), target: 'Paquets' });
    if (route) {
      event('packs_navigation_start');
      const packResponse = await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 15000 });
      report.navigation.status = packResponse?.status() || null;
      report.navigation.reached = new URL(page.url()).pathname === new URL(route).pathname;
      report.navigation.route = safeRoute(page.url());
      event('packs_navigation_complete', report.navigation);
      await snapshot('packs_document');
    }
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
    if (tryOpen && report.navigation.reached) {
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
    if (tryOpen && !report.navigation.reached) report.opening.reason = route ? 'packs_navigation_redirected' : 'packs_navigation_link_not_found';
    await Promise.allSettled(responseTasks);
    report.frames = [];
    for (const frame of page.frames().slice(0, 12)) {
      try {
        const state = await frame.evaluate(() => {
          const visible = el => Boolean(el.getClientRects().length) && getComputedStyle(el).visibility !== 'hidden';
          const text = document.body?.innerText || '';
          return { readyState: document.readyState, visibleCheckboxCount: [...document.querySelectorAll('input[type="checkbox"],[role="checkbox"]')].filter(visible).length, verificationTextVisible: /verify|human|vérification|verification/i.test(text), errorLines: text.split('\n').filter(line => /error|erreur|failed|échec|unsupported|non pris en charge|timed out/i.test(line)).slice(0, 6).map(line => line.slice(0, 500)) };
        });
        report.frames.push({ ...publicResource(frame.url()), ...state, errorLines: state.errorLines.map(redact) });
      } catch { report.frames.push({ ...publicResource(frame.url()), inspection: 'unavailable' }); }
    }
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
    report.networkDiagnostic = await networkCheck;
    report.findings = reportFindings(report);
    report.durationMs = elapsed();
    report.completedAt = new Date().toISOString();
    event('finished', { outcome: report.outcome });
    // Reapply secret masking to the complete exported report before logging.
    let publicJson = JSON.stringify(report);
    for (const secret of secrets.filter(value => typeof value === 'string' && value.length >= 4)) {
      publicJson = publicJson.split(JSON.stringify(secret).slice(1, -1)).join('[masqué]');
    }
    const publicReport = JSON.parse(publicJson);
    try { report.reportId = logBrowserDiagnostic(publicReport); } catch { report.diagnosticLoggingFailed = true; }
  }
  return report;
}
