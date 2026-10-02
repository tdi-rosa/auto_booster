const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function runPrivateDebug(raw, { claim, resolve, run, write }) {
  if (!raw) return;
  let job;
  try { job = JSON.parse(raw); } catch { write({ status: 'invalid_command' }); return; }
  if (!UUID.test(job?.id || '') || !UUID.test(job?.reportId || '')) { write({ status: 'invalid_command' }); return; }
  if (job.engine && !['playwright', 'patchright', 'patchright-chrome', 'patchright-chrome-headed'].includes(job.engine)) { write({ status: 'invalid_engine' }); return; }
  if (!await claim(job.id)) return;
  write({ jobId: job.id, status: 'started' });
  try {
    const clientId = await resolve(job.reportId);
    if (!clientId) { write({ jobId: job.id, status: 'target_unavailable' }); return; }
    const result = await run(clientId, { manual: true, browserEngine: job.engine || 'playwright' });
    write({ jobId: job.id, status: result.ok ? 'succeeded' : result.skipped ? 'skipped' : 'stopped', reason: result.skipped ? result.reason : undefined });
  } catch { write({ jobId: job.id, status: 'failed' }); }
}
