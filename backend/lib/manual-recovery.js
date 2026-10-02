import { CaptchaRequiredError } from './captcha.js';

export async function openWithBrowserReport(session, { open, probe, onBlocked }) {
  try { return await open(session); }
  catch (firstError) {
    if (!(firstError instanceof CaptchaRequiredError)) throw firstError;
    const partial = firstError.partialResult || { session, cards: [], packsOpened: 0 };
    await onBlocked(firstError);
    const report = await probe(partial.session);
    report.trigger = 'manual_open_antibot';
    report.initialDiagnostic = firstError.diagnostic;
    report.retry = { attempted: false, outcome: 'skipped' };
    if (report.opening?.requested) {
      report.retry = { attempted: report.opening.clicked, outcome: report.outcome, via: 'site_button' };
      if (report.openingResult) {
        const result = report.openingResult;
        return { ...result, cards: [...partial.cards, ...result.cards], packsOpened: partial.packsOpened + result.packsOpened, browserDiagnostic: report };
      }
      firstError.browserDiagnostic = report;
      throw firstError;
    }
    if (report.outcome !== 'page_loaded') {
      firstError.browserDiagnostic = report;
      throw firstError;
    }
    report.retry.attempted = true;
    try {
      const result = await open(partial.session);
      report.retry.outcome = 'success';
      return { ...result, cards: [...partial.cards, ...result.cards], packsOpened: partial.packsOpened + result.packsOpened, browserDiagnostic: report };
    } catch (error) {
      report.retry.outcome = error instanceof CaptchaRequiredError ? 'antibot_still_required' : 'opening_error';
      report.retry.diagnostic = error.diagnostic || null;
      error.browserDiagnostic = report;
      const second = error.partialResult || { session: partial.session, cards: [], packsOpened: 0 };
      error.partialResult = { session: second.session, cards: [...partial.cards, ...second.cards], packsOpened: partial.packsOpened + second.packsOpened };
      throw error;
    }
  }
}
