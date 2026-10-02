import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setContent('<title>Browser runtime check</title>');
if (await page.title() !== 'Browser runtime check') throw new Error('Browser runtime check failed');
await browser.close();
console.log('Chromium runtime check passed');
