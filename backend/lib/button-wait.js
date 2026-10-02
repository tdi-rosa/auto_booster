export async function waitForOpeningButton({ button, snapshot, now, sleep, timeoutMs }) {
  const started = now();
  let seen = false;
  while (now() - started < timeoutMs) {
    await snapshot('waiting_for_button');
    if (await button.count()) {
      seen = true;
      if (await button.isEnabled()) return { ready: true, seen, waitedMs: now() - started };
    }
    await sleep(1000);
  }
  return { ready: false, seen, waitedMs: now() - started };
}
