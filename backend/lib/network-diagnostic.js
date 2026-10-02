import { lookup } from 'node:dns/promises';
export function isNonFatalDnsProbe(raw, reason) {
  try { const host = new URL(raw).hostname; return /ERR_NAME_NOT_RESOLVED/.test(reason || '') && ((host.endsWith('.challenges.cloudflare.com') && host !== 'challenges.cloudflare.com') || host.endsWith('.dnstest.dev')); } catch { return false; }
}
async function dnsCheck(host, family) {
  const started = Date.now();
  let timer;
  try {
    const addresses = await Promise.race([lookup(host, { family, all: true }), new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error(), { code: 'TIMEOUT' })), 2500); })]);
    return { host, family, ok: true, addressCount: addresses.length, durationMs: Date.now() - started };
  } catch (error) { return { host, family, ok: false, code: ['ENOTFOUND', 'EAI_AGAIN', 'TIMEOUT'].includes(error.code) ? error.code : 'DNS_ERROR', durationMs: Date.now() - started }; }
  finally { clearTimeout(timer); }
}
export async function networkDiagnostic() {
  const [dns, https] = await Promise.all([
    Promise.all(['challenges.cloudflare.com', 'brunhild.challenges.cloudflare.com'].flatMap(host => [4, 6].map(family => dnsCheck(host, family)))),
    (async () => {
      try { const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/api.js', { signal: AbortSignal.timeout(5000) }); const result = { host: 'challenges.cloudflare.com', status: r.status, ok: r.ok }; await r.body?.cancel(); return result; }
      catch (error) { return { host: 'challenges.cloudflare.com', ok: false, category: error.name === 'TimeoutError' ? 'timeout' : 'network_or_tls' }; }
    })()
  ]);
  return { capturedAt: new Date().toISOString(), dns, https, note: 'Les erreurs DNS des sous-domaines de contrôle Cloudflare peuvent être attendues et non fatales ; elles ne prouvent pas la cause du blocage.' };
}
