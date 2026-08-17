/**
 * Click the whole thing, like a person. Nothing here reads source.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const BASE = 'http://127.0.0.1:4399';
const FLAG = process.argv[2];   // the sandboxed first-run.json
// The About-you record lives at the DATA root (the flag's grandparent, per
// engine/you.js's BASE), and it is first-run state: left behind by an
// earlier run it prefills the About-you step and arms the gate, so the "Continue waits"
// assertions would measure the leftover, not the gate. Cleared everywhere
// the flag is cleared.
const YOU = path.join(path.dirname(path.dirname(FLAG)), 'you.json');

const fails = [];
const ok = (cond, what) => { if (!cond) fails.push(what); console.log(`${cond ? '  ok  ' : ' FAIL '} ${what}`); };

async function fresh(browser, opts = {}) {
  fs.rmSync(FLAG, { force: true });
  fs.rmSync(YOU, { force: true });
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
    ok(await page.locator('#fr-title').textContent() === 'Kosmos is now installed on this computer.', 'on step 1, the Success screen');
    ok((await page.locator('#fr-eyebrow').textContent()).trim() === 'Success', 'the Success eyebrow is up');
    ok((await page.locator('#fr-segs .fr-seg').count()) === 0, 'the intro carries no progress segments');
    // The app-location look lives HERE now (the pack's Success screen).
    // Against this real machine any state is legitimate; what must be true is
    // that a row rendered, the answer replaced the placeholder, and the Dock
    // sentence is the ruled drag line, never the unreachable Keep in Dock.
    await page.waitForSelector('#fr-return-row .fr-check:not(.checking)', { timeout: 5000 });
    const introText = await page.locator('#fr-return').textContent();
    ok(/Drag Kosmos onto the Dock, the strip of icons/.test(introText), 'the ruled Dock drag line is on the Success screen');
    ok(!/Checking where the Kosmos icon is/.test(introText), 'the live answer replaced the checking placeholder');
    ok(!/right now/.test(introText), 'and it is the route\'s answer, not the could-not-ask fallback -- this walk is the one place the LIVE route is proven');
    ok(!/Keep in Dock/.test(introText), 'and never the unreachable Keep in Dock');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === true),
      'the board behind it is inert');
    // ⚠️ Asked, not assumed: what does a click at the middle of the screen hit?
    ok(await page.evaluate(() => document.querySelector('#firstrun')
      .contains(document.elementFromPoint(300, 400))), 'nothing behind it is clickable');

    console.log('   ...clicking through every step, in the pack\'s order');
    ok(/Set up Kosmos/.test(await page.locator('#fr-next').textContent()), 'the Success primary is Set up Kosmos');
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Create and manage AI agents that work for you.', 'step 2, Welcome');
    ok((await page.locator('#fr-segs .fr-seg').count()) === 5, 'five segments from Welcome on');
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Choose a model.', 'step 3, Model');
    ok((await page.locator('#fr-pane-3 .llm').count()) === 6, 'the six-provider list is drawn');
    ok(await page.locator('#fr-sub .fr-ctitle').textContent().then((t) => /connected/.test(t)),
      'the real subscription answer arrived: ' + await page.locator('#fr-sub .fr-ctitle').textContent());
    await page.click('#fr-next');
    ok(await page.locator('#fr-title').textContent() === 'Checking this computer.', 'step 4, This computer');
    await page.waitForSelector('#fr-checks .fr-check', { timeout: 5000 });
    ok((await page.locator('#fr-checks .fr-check').count()) === 3, 'three checks painted from the live route (app-location rides on the Success screen, not among them)');
    await page.click('#fr-next');
    // Step 5, About you. The gate IS the design (no skip, at Josh's call):
    // Continue WAITS on the two required answers, and the third is optional.
    ok(await page.locator('#fr-title').textContent() === 'Who are your agents working for?', 'step 5, about you');
    ok(await page.locator('#fr-next').isDisabled(), 'Continue waits for the two required answers');
    await page.fill('#fr-you-name', 'Josh');
    ok(await page.locator('#fr-next').isDisabled(), 'one answer alone does not arm it');
    await page.fill('#fr-you-do', 'I run a company that builds AI tools');
    ok(!(await page.locator('#fr-next').isDisabled()), 'both answers arm Continue; the third stays optional');
    await page.click('#fr-next');
    // Continue SAVES before it advances (a real PUT on this live server), so
    // wait for the step change rather than reading the title mid-flight.
    await page.waitForSelector('#fr-pane-5', { state: 'hidden', timeout: 5000 });
    ok(/already have/.test(await page.locator('#fr-title').textContent()), 'step 6, the adopt ending');
    ok(/Take me to my agents/.test(await page.locator('#fr-next').textContent()),
      'the adopt ending carries the pack\'s single action');
    console.log('   ...and out the front door, through the adopt ending');
    await page.click('#fr-next');
    await page.waitForTimeout(600);
    ok(await page.isHidden('#firstrun'), 'the overlay closed');
    ok(await page.isVisible('#grid'), 'the board is there');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === false),
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
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === false),
      'and nothing left the page inert');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n3. Back, and Skip, and Escape');
  {
    const { ctx, page } = await fresh(browser);
    await page.click('#fr-next');
    await page.click('#fr-next');
    // ⚠️ NO BACK anywhere (Josh, 2026-08-17): the flow only moves forward.
    ok((await page.locator('#fr-back').count()) === 0, 'no Back button exists on any step');
    ok(await page.locator('#fr-title').textContent() === 'Choose a model.', 'Continue advanced exactly one step');
    // The visible Skip died by the pack's ruling; Escape is the exit and it
    // carries the same contract (marks seen, so it does not nag).
    ok((await page.locator('#fr-skip').count()) === 0, 'no visible Skip link anywhere (pack decisions table)');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    ok(await page.isHidden('#firstrun'), 'Escape closed it');
    ok(fs.existsSync(FLAG), 'Escape marked it seen, so it does not nag');
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    ok(await page.isHidden('#firstrun'), 'Escape closed it');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === false),
      'Escape did not leave the page inert and unusable');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n4. The hand-off into making an agent actually lands there');
  {
    const { ctx, page } = await fresh(browser, {
      route: ['**/api/first-run', (r) => r.fulfill({ json: { done: false, fleetKnown: true, fleetCount: 0, fleetNames: [], path: 'create', subscription: { state: 'connected', plan: 'Claude Max', because: '' } } })],
    });
    // Success -> Welcome -> Model -> This computer -> About you -> ending.
    await page.click('#fr-next'); await page.click('#fr-next'); await page.click('#fr-next'); await page.click('#fr-next');
    await page.fill('#fr-you-name', 'Josh');
    await page.fill('#fr-you-do', 'Testing the create path');
    await page.click('#fr-next');
    await page.waitForSelector('#fr-pane-5', { state: 'hidden', timeout: 5000 });
    ok(/Create your first agent/.test(await page.locator('#fr-title').textContent()), 'on the create ending');
    ok(/Create my first agent/.test(await page.locator('#fr-next').textContent()),
      'the create ending carries the pack\'s single action');
    await page.click('#fr-next');
    await page.waitForTimeout(800);
    ok(await page.isHidden('#firstrun'), 'the overlay got out of the way');
    ok(await page.isVisible('#panel-create'), 'and the create panel is open');
    // ⚠️ Not just open — usable. The deep-link version of this shipped with an
    // empty role list and a dead Continue once.
    // The picker is the three-radio shape now (pm / list / own since the
    // write-my-own build): loaded means the radios are visible, which only
    // the fetch un-hides.
    await page.waitForSelector('#roles-list .pick2', { state: 'visible', timeout: 5000 }).catch(() => {});
    ok((await page.locator('#roles-list .pick2:visible').count()) === 3, 'with its roles actually loaded');
    ok(await page.isVisible('#cstep-role'), 'on step one of creating, not somewhere mid-flow');
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n5. A first-run route that fails does NOT put onboarding over a working board');
  {
    fs.rmSync(FLAG, { force: true });
    fs.rmSync(YOU, { force: true });
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
    // The machine step is 4 now: Success -> Welcome -> Model -> here.
    await page.click('#fr-next'); await page.click('#fr-next'); await page.click('#fr-next');
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
    await page.keyboard.press('Escape');
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
      [1, 2, 3, 4, 5, 6].filter((i) => !document.getElementById('fr-pane-' + i).hidden));
    ok(panes.length === 1, `fr-step=${bad} shows exactly one pane (showed ${panes.length})`);
    const crumb = await page.locator('#fr-step').textContent();
    ok(/^(Kosmos setup|Step [1-5] of 5)$/.test(crumb), `fr-step=${bad} prints a whole step ("${crumb}")`);
    ok((await page.locator('#fr-title').textContent()).trim().length > 0, `fr-step=${bad} has a heading`);
    await ctx.close();
  }

  /* ------------------------------------------------------------------ */
  console.log('\n9. Escape during an in-flight completion does not fire two of them');
  {
    fs.rmSync(FLAG, { force: true });
    fs.rmSync(YOU, { force: true });
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
    // Success -> Welcome -> Model -> This computer -> About you -> ending
    await page.click('#fr-next'); await page.click('#fr-next'); await page.click('#fr-next'); await page.click('#fr-next');
    await page.fill('#fr-you-name', 'Josh');      // About you gates step 5
    await page.fill('#fr-you-do', 'Testing');
    await page.click('#fr-next');                 // step 5 -> 6 (saves first)
    await page.waitForSelector('#fr-pane-5', { state: 'hidden', timeout: 5000 });
    await page.click('#fr-next');                 // starts "Create my first agent"
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
    fs.rmSync(YOU, { force: true });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => fails.push('JS ERROR: ' + e.message));
    // Never fulfilled. The overlay must degrade into its could-not-remember
    // path rather than sitting disabled over an inert page forever.
    await page.route('**/api/first-run/complete', () => {});
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(10000);            // past the 8s abort
    ok(await page.locator('#fr-forgot').isVisible(), 'a hung POST turned into a message, not a trap');
    ok(await page.isEnabled('#fr-next'), 'and the way out came back');
    await page.click('#fr-next');
    await page.waitForTimeout(400);
    ok(await page.isHidden('#firstrun'), 'and it actually let them out');
    ok(await page.evaluate(() => document.querySelector('.apphead').inert === false),
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
    ok(await page.evaluate(() => !document.querySelector('.apphead').inert),
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
    // The way out is Escape; prove it WORKS from keyboard-land rather than
    // asserting something tab-reachable that line above already proved.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    ok(await page.isHidden('#firstrun'), 'Escape closes setup from anywhere in the trap');

    // Every step, because the button set changes between them.
    for (const step of [2, 3, 4, 5, 6]) {
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
      // The machine step is 4 now.
      await page.click('#fr-next'); await page.click('#fr-next'); await page.click('#fr-next');
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
