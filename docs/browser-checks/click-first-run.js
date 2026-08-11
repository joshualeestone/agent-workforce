/**
 * Click the whole thing, like a person. Nothing here reads source.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const BASE = 'http://127.0.0.1:4399';
const FLAG = process.argv[2];   // the sandboxed first-run.json

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); };

async function fresh(browser, opts = {}) {
  fs.rmSync(FLAG, { force: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
  if (opts.route) await page.route(...opts.route);
  await page.goto(`${BASE}/${opts.query || ''}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  return { ctx, page };
}

(async () => {
  const browser = await chromium.launch({ headless: process.env.HEADED === '0' });

  /* ------------------------------------------------------------------ */
  console.log('\n1. A machine that has never been through it opens ON first run');
  {
    const { ctx, page } = await fresh(browser);
    ok(await page.isVisible('#firstrun'), 'the overlay is up with no ?first-run flag at all');
    ok(await page.locator('#fr-title').textContent() === 'Welcome to Agent Workforce', 'on step 1');
    ok(await page.evaluate(() => document.querySelector('body > header').inert === true),
      'the board behind it is inert');
    // ⚠️ Asked, not assumed: what does a click at the middle of the screen hit?
    ok(await page.evaluate(() => document.querySelector('#firstrun')
      .contains(document.elementFromPoint(300, 400))), 'nothing behind it is clickable');

    console.log('   ...clicking Continue through every step');
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Checking your computer', 'step 2');
    await page.waitForSelector('.fr-check', { timeout: 5000 });
    ok((await page.locator('#fr-checks .fr-check').count()) === 3, 'three checks painted from the live route');
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Claude', 'step 3');
    ok(await page.locator('#fr-sub .fr-ctitle').textContent().then((t) => /connected/.test(t)),
      'the real subscription answer arrived: ' + await page.locator('#fr-sub .fr-ctitle').textContent());
    await page.click('#fr-next');
    ok(/already have/.test(await page.locator('#fr-title').textContent()), 'step 4, the adopt path');

    console.log('   ...and out the front door');
    await page.click('#fr-next');
    await page.waitForTimeout(600);
    ok(await page.isHidden('#firstrun'), 'the overlay closed');
    ok(await page.isVisible('#grid'), 'the board is there');
    ok(await page.evaluate(() => document.querySelector('body > header').inert === false),
      'the board is interactive again');
    ok(fs.existsSync(FLAG), 'the flag was written, so it will not reappear');
    // ⚠️ The control for that last one: it was NOT there a moment ago.
    ok(JSON.parse(fs.readFileSync(FLAG, 'utf8')).completedAt, 'and the flag has a timestamp in it');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n2. Having been through it, it does not come back');
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ok(await page.isHidden('#firstrun'), 'a returning person gets their board, not onboarding');
    ok(await page.evaluate(() => document.querySelector('body > header').inert === false),
      'and nothing left the page inert');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n3. Back, and Skip, and Escape');
  {
    const { ctx, page } = await fresh(browser);
    await page.click('#fr-next');
    await page.click('#fr-next');
    await page.click('#fr-back');
    ok(await page.locator('#fr-title').textContent() === 'Checking your computer', 'Back went back one step');
    // ⚠️ The handler-stacking test. Back then Continue must advance ONE step; if
    // the buttons accumulated listeners it would fire two steps at once.
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Claude',
      'Continue after Back advanced exactly one step');
    await page.click('#fr-skip');
    await page.waitForTimeout(600);
    ok(await page.isHidden('#firstrun'), 'Skip closed it');
    ok(fs.existsSync(FLAG), 'Skip marked it seen, so it does not nag');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    ok(await page.isHidden('#firstrun'), 'Escape closed it');
    ok(await page.evaluate(() => document.querySelector('body > header').inert === false),
      'Escape did not leave the page inert and unusable');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n4. The hand-off into making an agent actually lands there');
  {
    const { ctx, page } = await fresh(browser, {
      route: ['**/api/first-run', (r) => r.fulfill({ json: { done: false, fleetKnown: true, fleetCount: 0, fleetNames: [], path: 'create', subscription: { state: 'connected', plan: 'Claude Max', because: '' } } })],
    });
    await page.click('#fr-next'); await page.click('#fr-next'); await page.click('#fr-next');
    ok(/first agent/.test(await page.locator('#fr-title').textContent()), 'on the create path');
    await page.click('#fr-next');
    await page.waitForTimeout(800);
    ok(await page.isHidden('#firstrun'), 'the overlay got out of the way');
    ok(await page.isVisible('#panel-create'), 'and the create panel is open');
    // ⚠️ Not just open — usable. The deep-link version of this shipped with an
    // empty role list and a dead Continue once.
    ok((await page.locator('#roles-list .pick').count()) > 0, 'with its roles actually loaded');
    ok(await page.isVisible('#cstep-role'), 'on step one of creating, not somewhere mid-flow');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n5. A first-run route that fails does NOT put onboarding over a working board');
  {
    fs.rmSync(FLAG, { force: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    await page.route('**/api/first-run', (r) => r.fulfill({ status: 500, json: { error: 'nope' } }));
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    ok(await page.isHidden('#firstrun'), 'no overlay when we could not read whether to show one');
    ok(await page.isVisible('#grid'), 'and the board painted anyway');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n6. A machine check route that fails says so, rather than showing three ticks');
  {
    const { ctx, page } = await fresh(browser, {
      route: ['**/api/machine', (r) => r.abort()],
    });
    await page.click('#fr-next');
    await page.waitForTimeout(800);
    const text = await page.locator('#fr-checks').textContent();
    ok(/could not check/i.test(text), 'it says it could not look: ' + text.slice(0, 60));
    ok(!/&#10003;|✓/.test(await page.locator('#fr-checks').innerHTML()), 'and draws no ticks');
    ok(await page.isEnabled('#fr-next'), 'and does not trap anybody there');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n7. A completion flag that will not stick is SAID, not swallowed');
  {
    const { ctx, page } = await fresh(browser, {
      route: ['**/api/first-run/complete', (r) => r.fulfill({ status: 500, json: { error: 'we could not remember that, so this may appear again next time' } })],
    });
    await page.click('#fr-skip');
    await page.waitForTimeout(600);
    ok(await page.isVisible('#firstrun'), 'it stayed up long enough to say so');
    const said = await page.locator('#fr-forgot').textContent();
    ok(/could not remember/i.test(said), 'and it said it: ' + said.trim().slice(0, 60));
    // ⚠️ Raised from step ONE, where the message used to be written into a
    // hidden div and nobody ever saw it.
    ok(await page.locator('#fr-forgot').isVisible(), 'and the sentence is actually on screen');
    ok(await page.locator('#fr-next').textContent() === 'Carry on anyway', 'with a way onward');
    await page.click('#fr-next');
    await page.waitForTimeout(400);
    ok(await page.isHidden('#firstrun'), 'and the second click always gets out');
    await ctx.close();
  }

  await browser.close();
  console.log('\n' + (fails.length ? `${fails.length} FAILURES:\n  ` + fails.join('\n  ') : 'all clear'));
  process.exit(fails.length ? 1 : 0);
})();
