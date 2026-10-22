const { chromium } = require('playwright');
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');

(async () => {
  const server = spawn('python3', ['-m', 'http.server', '18765', '--bind',
    '127.0.0.1', '--directory', process.argv[2]], { stdio: 'ignore' });
  let browser;
  let page;
  const errors = [];
  const diagnostics = [];
  try {
    for (let attempt = 0; ; attempt++) {
      try { await fetch('http://127.0.0.1:18765/build-info.json'); break; }
      catch (error) {
        if (attempt === 40) throw error;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    browser = await chromium.launch({ headless: true });
    // Do not inherit the CI host's POSIX locale tag (e.g. en-US@posix),
    // which Intl.Locale in the pinned Flutter engine cannot parse.
    page = await browser.newPage({ locale: 'en-US' });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (['error', 'warning'].includes(message.type())) diagnostics.push(message.text());
    });
    page.on('requestfailed', request => diagnostics.push(
      `request failed: ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`));
    await page.addInitScript(() => {
      window.addEventListener('flutter-first-frame', () => {
        window.englishpodFirstFrame = true;
      });
    });
    const response = await page.goto('http://127.0.0.1:18765/');
    assert.equal(response.status(), 200);
    await page.waitForFunction(() => window.englishpodBootComplete === true,
      undefined, { timeout: 60000 });
    assert.equal(await page.locator('flutter-view').count(), 1);
    await page.locator('flutter-view canvas').first().waitFor({state: 'visible'});
    assert.equal(await page.evaluate(() => window.englishpodBootError), undefined);
    assert.deepEqual(errors, [], 'Uncaught browser runtime error');
    console.log('PASS: compiled Flutter Web runApp completes and visible canvas renders. Real audio/device behavior NOT TESTED.');
  } catch (error) {
    console.error('Web boot diagnostics:', JSON.stringify({errors,
      diagnostics: diagnostics.slice(-20),
      state: page && await page.evaluate(() => ({
        bootComplete: window.englishpodBootComplete,
        bootError: window.englishpodBootError,
        language: navigator.language,
        languages: navigator.languages,
        views: document.querySelectorAll('flutter-view').length,
        canvas: document.querySelectorAll('canvas').length,
        text: document.body.innerText.slice(0, 300),
      })).catch(() => null)}));
    throw error;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
