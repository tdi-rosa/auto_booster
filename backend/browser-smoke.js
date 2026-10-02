import { networkDiagnostic } from './lib/network-diagnostic.js';
import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setContent('<title>Browser runtime check</title>');
if (await page.title() !== 'Browser runtime check') throw new Error('Browser runtime check failed');
await browser.close();
console.log('Chromium runtime check passed');

console.log('Network diagnostic ' + JSON.stringify(await networkDiagnostic()));

const { chromium: experimentalChromium } = await import('patchright');
for (const headless of [true, false]) {
  const chrome = await experimentalChromium.launch({ channel: 'chrome', headless, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const tab = await chrome.newPage();
    await tab.setContent('<title>Chrome runtime check</title>');
    if (await tab.title() !== 'Chrome runtime check') throw new Error('Chrome runtime check failed');
    console.log(`Chrome runtime check passed: headless=${headless}, version=${chrome.version()}`);
  } finally { await chrome.close(); }
}
