const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireTools = createRequire(path.join(process.env.RELEASE_TOOLS, 'package.json'));
const { chromium } = requireTools('playwright');
const mode = process.argv[2];
const evidence = process.env.RELEASE_EVIDENCE;
const receipt = JSON.parse(fs.readFileSync(path.join(evidence, mode + '-receipt.json')));
const config = JSON.parse(fs.readFileSync('.github/deploy/release-policy.json'));
const check = (ok, message) => { if (!ok) throw Error(message); };

(async () => {
  const browser = await chromium.launch();
  const tested = [], failures = [];
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.on('pageerror', () => failures.push('page-script-error'));
      page.on('requestfailed', request => {
        if (new URL(request.url()).origin === new URL(receipt.url).origin) failures.push('internal-request-failed');
      });
      page.on('response', response => {
        if (response.status() >= 400 && new URL(response.url()).origin === new URL(receipt.url).origin) failures.push('internal-http-error');
      });
      for (const route of config.key_pages) {
        const response = await page.goto(receipt.url + route, { waitUntil: 'networkidle' });
        check(response && response.ok(), 'Key page failed to load.');
        const source = route === '/' ? 'index.html' : route.slice(1) + '.html';
        const expected = fs.readFileSync(path.join(process.env.RELEASE_SITE, source));
        check((await response.body()).equals(expected), 'Served key page differs from staged source.');
        check(await page.locator('h1').count() > 0 && await page.locator('main').count() > 0, 'Key page lacks its main content or heading.');
        check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'Key page has horizontal overflow.');
        if (route === '/search') {
          const input = page.locator('#search-page input[type="search"]');
          await input.fill('Braille');
          await input.press('Enter');
          await page.locator('#search-page [data-search-results] a').first().waitFor({ state: 'visible', timeout: 20000 });
          const status = await page.locator('#search-page [data-search-status]').innerText();
          check(!/unavailable|Searching/i.test(status), 'Search did not complete.');
          const open = page.locator('[data-search-open]');
          await open.focus();
          await open.press('Enter');
          const dialog = page.locator('.search-dialog-backdrop');
          check(await dialog.isVisible(), 'Keyboard search control did not open.');
          await page.keyboard.press('Escape');
          check(!await dialog.isVisible() && await open.evaluate(el => el === document.activeElement), 'Search did not close and restore keyboard focus.');
        }
        tested.push({ route, width });
      }
      await context.close();
    }
    check(failures.length === 0, 'Key pages reported script or internal resource failures.');
    fs.writeFileSync(path.join(evidence, mode + '-browser-checks.json'), JSON.stringify({ passed: true, tested }, null, 2) + '\n');
    console.log('Key pages, served bytes, mobile reflow, internal resources, and keyboard search checks passed.');
  } catch (error) {
    fs.writeFileSync(path.join(evidence, mode + '-browser-checks.json'), JSON.stringify({ passed: false, tested, failure: error.message }, null, 2) + '\n');
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
