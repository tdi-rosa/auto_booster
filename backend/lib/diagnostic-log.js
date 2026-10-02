import { randomUUID } from 'node:crypto';

// Only pass the public diagnostic, never a client record or a session.
// Chunks keep each Railway log entry small enough to retrieve intact.
export function logBrowserDiagnostic(report, write = line => console.log(line)) {
  const reportId = randomUUID();
  const payload = JSON.stringify(report);
  const chunks = payload.match(/[\s\S]{1,4000}/g) || [''];
  chunks.forEach((data, index) => write(JSON.stringify({
    event: 'WMA_BROWSER_DIAGNOSTIC', reportId,
    part: index + 1, total: chunks.length, data
  })));
  return reportId;
}
