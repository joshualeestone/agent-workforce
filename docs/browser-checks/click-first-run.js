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
    ok((await page.locator('#fr-checks .fr-check').count()) === 3, 'three checks painted from the live route (app-location rides beside the rows, not among them)');
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Claude', 'step 3');
    ok(await page.locator('#fr-sub .fr-ctitle').textContent().then((t) => /connected/.test(t)),
      'the real subscription answer arrived: ' + await page.locator('#fr-sub .fr-ctitle').textContent());
    await page.click('#fr-next');
    ok(/already have/.test(await page.locator('#fr-title').textContent()), 'step 4, the adopt path');
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Getting back to Kosmos', 'step 5, getting back');
    // The check row is painted from the live /api/machine look; against this
    // real machine any of the four states is legitimate -- what must be true
    // is that A row rendered and the Dock sentence is the drag instruction,
    // never "Keep in Dock" (the orientation spec's load-bearing guard: the
    // Dock tile exits before anyone can right-click it).
    // Wait for the ANSWER, not the pane: the pane paints instantly with the
    // "checking" placeholder, so waiting on any .fr-check reads the pre-paint
    // in a race with the fetch.
    await page.waitForSelector('#fr-return-row .fr-check:not(.checking)', { timeout: 5000 });
    const returnText = await page.locator('#fr-return').textContent();
    ok(/drag it onto the Dock|Drag Kosmos out of that folder/.test(returnText), 'the Dock instruction is a drag (the wording tracks whether a folder was found on THIS machine)');
    ok(!/Checking where the Kosmos icon is/.test(returnText), 'the live answer replaced the checking placeholder');
    ok(!/Keep in Dock/.test(returnText), 'and never the unreachable Keep in Dock');
    ok(/Closing this tab does not stop your agents/.test(returnText),
      'the narrow true promise about closing the tab');

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
    // The fork moved to step 5: step 4's Continue leads to the orientation,
    // whose primary carries "Make my first agent" on this path.
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Getting back to Kosmos', 'orientation before the fork');
    ok(/Make my first agent/.test(await page.locator('#fr-next').textContent()),
      'the create-path fork rode along to step 5');
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

  /* ------------------------------------------------------------------ */
  console.log('\n8. A deep link with rubbish in it still renders a step');
  for (const bad of ['3.7', '2.5', '0', '99', 'banana', '-1', '<script>']) {
    const { ctx, page } = await fresh(browser, { query: '?first-run=1&fr-step=' + encodeURIComponent(bad) });
    // ⚠️ The failure this is for drew a titled, buttoned, COMPLETELY EMPTY
    // dialog: frGo(3.7) matched no pane, so it hid all four and painted step 4
    // into one it had just hidden.
    const panes = await page.evaluate(() =>
      [1, 2, 3, 4, 5].filter((i) => !document.getElementById('fr-pane-' + i).hidden));
    ok(panes.length === 1, `fr-step=${bad} shows exactly one pane (showed ${panes.length})`);
    const crumb = await page.locator('#fr-step').textContent();
    ok(/^Step [1-5] of 5$/.test(crumb), `fr-step=${bad} prints a whole step ("${crumb}")`);
    ok((await page.locator('#fr-title').textContent()).trim().length > 0, `fr-step=${bad} has a heading`);
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n9. Escape during an in-flight completion does not fire two of them');
  {
    fs.rmSync(FLAG, { force: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    let posts = 0;
    await page.route('**/api/first-run/complete', async (r) => {
      posts += 1;
      await new Promise((res) => setTimeout(res, 1200));   // hold it open
      r.fulfill({ json: { done: true } });
    });
    await page.route('**/api/first-run', (r) => r.fulfill({ json: { done: false, fleetKnown: true, fleetCount: 0, fleetNames: [], path: 'create', subscription: { state: 'connected', plan: 'Claude Max', because: '' } } }));
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#fr-next'); await page.click('#fr-next'); await page.click('#fr-next');
    await page.click('#fr-next');                 // step 4 -> 5 (the fork moved)
    await page.click('#fr-next');                 // starts "Make my first agent"
    await page.waitForTimeout(150);
    await page.keyboard.press('Escape');          // ...and Escape mid-flight
    await page.keyboard.press('Escape');
    await page.waitForTimeout(2200);
    ok(posts === 1, `exactly one completion was written (saw ${posts})`);
    // ⚠️ And the callback that won is the one they CHOSE. Two completions ran
    // both callbacks, so openCreate() opened the panel and showTab('agents')
    // took it straight back off.
    ok(await page.isVisible('#panel-create'),
      'the create panel they asked for survived, rather than being closed by a second callback');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n10. A completion POST that never answers does not lock anybody in');
  {
    fs.rmSync(FLAG, { force: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    // Never fulfilled. The overlay must degrade into its could-not-remember
    // path rather than sitting disabled over an inert page forever.
    await page.route('**/api/first-run/complete', () => {});
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.click('#fr-skip');
    await page.waitForTimeout(10000);            // past the 8s abort
    ok(await page.locator('#fr-forgot').isVisible(), 'a hung POST turned into a message, not a trap');
    ok(await page.isEnabled('#fr-next'), 'and the way out came back');
    await page.click('#fr-next');
    await page.waitForTimeout(400);
    ok(await page.isHidden('#firstrun'), 'and it actually let them out');
    ok(await page.evaluate(() => document.querySelector('body > header').inert === false),
      'and did not leave the board inert');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n11. The keyboard cannot get out of the dialog, in either direction');
  {
    const { ctx, page } = await fresh(browser);
    // ⚠️ The two NEWEST safety mechanisms in this branch -- a Tab-wrap trap and
    // a focusin backstop -- had no coverage of any kind. They are pure DOM
    // behaviour, so this harness is the only thing that can exercise them.
    const inside = () => page.evaluate(() =>
      document.querySelector('#firstrun').contains(document.activeElement));
    const where = () => page.evaluate(() => (document.activeElement
      && (document.activeElement.id || document.activeElement.tagName)) || 'none');

    /**
     * ⚠️ `inert` IS TURNED OFF FIRST, AND WITHOUT THAT THIS WHOLE SECTION IS
     * VACUOUS. Measured: with both focus mechanisms deliberately disabled, every
     * assertion below still passed — because Chromium implements `inert`, and
     * `inert` alone keeps Tab inside. The section was testing the browser, not
     * the code.
     *
     * The Tab-wrap and the focusin backstop exist precisely FOR engines that do
     * not implement `inert`, where `el.inert = true` is a property nobody reads.
     * Clearing the attributes here reproduces exactly that machine, so what is
     * measured below is the fallback rather than the thing it is a fallback for.
     */
    await page.evaluate(() => {
      document.querySelectorAll('body > *').forEach((el) => { el.inert = false; el.removeAttribute('inert'); });
    });
    ok(await page.evaluate(() => !document.querySelector('body > header').inert),
      'inert really is off, so what follows measures the fallback and not the browser');

    ok(await inside(), 'focus starts inside the dialog (on ' + await where() + ')');

    // Forward, well past the number of stops on any step.
    let escaped = null;
    for (let i = 0; i < 25 && escaped === null; i += 1) {
      await page.keyboard.press('Tab');
      if (!(await inside())) escaped = 'forward at press ' + (i + 1) + ' onto ' + await where();
    }
    ok(escaped === null, escaped || 'Tab never leaves the dialog');

    // And backward, which is the direction the focusin-only version could not do.
    escaped = null;
    for (let i = 0; i < 25 && escaped === null; i += 1) {
      await page.keyboard.press('Shift+Tab');
      if (!(await inside())) escaped = 'backward at press ' + (i + 1) + ' onto ' + await where();
    }
    ok(escaped === null, escaped || 'Shift+Tab never leaves the dialog');

    /**
     * ⚠️ AND IT IS NOT A DEAD END EITHER. The focusin-only version pulled every
     * escape back to the heading, so Shift+Tab could never REACH the action
     * bar -- contained, but unusable. This asserts the buttons are actually
     * reachable backwards.
     */
    const seen = new Set();
    await page.evaluate(() => document.getElementById('fr-title').focus());
    for (let i = 0; i < 8; i += 1) { await page.keyboard.press('Shift+Tab'); seen.add(await where()); }
    ok(seen.has('fr-next'), 'Shift+Tab reaches the primary button (saw: ' + [...seen].join(', ') + ')');
    ok(seen.has('fr-skip'), 'Shift+Tab reaches the way out');

    // Every step, because the button set changes between them.
    for (const step of [2, 3, 4, 5]) {
      await page.goto(`${BASE}/?first-run=1&fr-step=${step}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(500);
      // Same reason as above: a reload restores inert, which would make the rest
      // of this loop measure the browser again.
      await page.evaluate(() => {
        document.querySelectorAll('body > *').forEach((el) => { el.inert = false; el.removeAttribute('inert'); });
      });
      let out = null;
      for (let i = 0; i < 20 && out === null; i += 1) {
        await page.keyboard.press('Tab');
        if (!(await inside())) out = await where();
      }
      ok(out === null, `step ${step}: Tab stays inside` + (out ? ' (escaped onto ' + out + ')' : ''));
    }
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n12. A machine-check body with nothing in it is not an empty screen');
  {
    for (const [what, body] of [['null', null], ['{}', {}], ['[]', []], ['no checks', { attention: 0, unknown: 0 }]]) {
      const { ctx, page } = await fresh(browser, {
        route: ['**/api/machine', (r) => r.fulfill({ json: body })],
      });
      await page.click('#fr-next');
      await page.waitForTimeout(700);
      const text = (await page.locator('#fr-checks').textContent()).trim();
      ok(text.length > 0, `a ${what} body still says something (${text.slice(0, 40)})`);
      ok(/could not check/i.test(text), `a ${what} body says we could not check, not nothing`);
      ok(await page.isEnabled('#fr-next'), `a ${what} body does not strand anybody`);
      await ctx.close();
    }
  }

  await browser.close();
  console.log('\n' + (fails.length ? `${fails.length} FAILURES:\n  ` + fails.join('\n  ') : 'all clear'));
  process.exit(fails.length ? 1 : 0);
})();
