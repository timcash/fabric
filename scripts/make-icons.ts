/**
 * Renders the brand SVGs in public/brand/ to the PNG icons a PWA needs (Android, maskable, iOS home screen) and
 * a social-share card. Run after editing the logo:  node --experimental-strip-types scripts/make-icons.ts
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const dir = new URL('../public/brand/', import.meta.url).pathname;
const chrome = process.env.CHROME_PATH || ['/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(p => existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
const logo = await readFile(join(dir, 'logo.svg'), 'utf8'), maskable = await readFile(join(dir, 'maskable.svg'), 'utf8');
const shot = async (html: string, size: [number, number], file: string, transparent = false) => {
  await page.setViewport({ width: size[0], height: size[1], deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:${transparent ? 'transparent' : '#000'}}svg{display:block;width:100vw;height:100vh}</style>${html}`);
  await page.screenshot({ path: join(dir, file) as `${string}.png`, omitBackground: transparent });
};
await shot(logo, [192, 192], 'icon-192.png', true);
await shot(logo, [512, 512], 'icon-512.png', true);
await shot(maskable, [512, 512], 'maskable-512.png');
await shot(maskable, [180, 180], 'apple-touch-icon.png'); // iOS rounds the corners itself
await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><style>
  body{margin:0;width:1200px;height:630px;display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box;
    background:#000;color:#fff;font-family:system-ui,-apple-system,'Segoe UI',sans-serif}
  svg{width:300px;height:300px;flex:none}
  p{margin:0;color:#bbb;letter-spacing:.18em;font-weight:700;font-size:26px}
  h1{margin:.2em 0 .25em;font-size:76px;line-height:1;letter-spacing:-.03em}
  span{color:#bbb;font-size:30px;line-height:1.35}
</style>${logo}<div><p>FABRIC</p><h1>Body Scan</h1><span>Measure a body with your phone camera.<br>Arms out, one walk around, on-device.</span></div>`);
await page.screenshot({ path: join(dir, 'og-image.png') as `${string}.png` });
await browser.close();
console.log(`Icons written to ${dir}`);
