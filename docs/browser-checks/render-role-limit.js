/**
 * Where a role's limit on what it reaches is READ, now that it is off the card.
 *
 * 🛑 WHY THIS IS RENDERED RATHER THAN GREPPED. The change this pins is a MOVE,
 * and a move is the one shape a source test cannot judge: the string is in the
 * file either way. `engine/roles.js` still carries the sentence, `web/index.html`
 * still mentions it in two places, and a grep for the words is green whether the
 * paragraph reaches a screen or sits hidden behind a role branch that never
 * runs. Only the page knows which.
 *
 * 🔑 AND THE FAILURE THIS EXISTS FOR IS "NOWHERE". On 2026-08-22 the sentence
 * came off the create card at Josh's instruction and 0.2.91 shipped with it in
 * no user-facing place at all, for about twenty minutes. A caution that is
 * nowhere is not a styling regression, it is the product no longer disclosing
 * that a Project Manager briefs other agents on its own -- and the person finds
 * out after it has. So this asserts BOTH halves, off the card AND on the last
 * step, because either one alone passes in the state that caused the incident.
 *
 * ⚠️ IT IS A PATTERN, NOT A STRING. Nine of the twenty-eight roles carry a
 * limit, so the last step is checked against a SECOND role as well: a paint
 * hardcoded to the project manager would satisfy a one-role check completely.
 *
 * Headless is fine here and that is a claim, not a default: everything below is
 * visible text plus the vertical order of two elements, which is layout. It
 * would not be fine for a screenshot or anything about paint.
 *
 * ⚠️ IT NEEDS A SANDBOX WITH FIRST RUN ALREADY COMPLETE, and that is not a
 * convenience. A fresh sandbox opens onboarding over the whole app, and this
 * script cannot be trusted to notice: it did not, until the occlusion assertion
 * below was added. Seed the flag before starting the server --
 *
 *   mkdir -p "$SB/data/AgentWorkforce"
 *   echo '{"completedAt":"2026-01-01T00:00:00.000Z"}' > "$SB/data/AgentWorkforce/first-run.json"
 *
 * Run: see the README in this directory.
 */
'use strict';

const { chromium } = require('playwright');

const BASE = process.argv[2] || 'http://127.0.0.1:4399';

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass: Boolean(pass), detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
}

/* The roles the app itself will serve, read from the same route the page reads,
   so this script never carries its own copy of a sentence it is checking. */
async function rolesFrom(page) {
  return page.evaluate(async (base) => {
    const r = await fetch(base + '/api/roles');
    const j = await r.json();
    return (j.roles || j || []).map((x) => ({ key: x.key, label: x.label, caution: x.caution || null }));
  }, BASE);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));

  await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
  await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 });

  const roles = await rolesFrom(page);
  const withLimit = roles.filter((r) => r.caution);
  /* ⚠️ THE DENOMINATOR, PRINTED. "Every role with a limit shows it" and "no role
     has a limit" are the same sentence to a checker that does not say how many. */
  check('the catalogue still carries limits at all', withLimit.length >= 2,
    `${withLimit.length} of ${roles.length} roles`);
  if (withLimit.length < 2) { await browser.close(); process.exit(1); }

  const pm = roles.find((r) => r.key === 'pm');
  check('the project manager is one of them', Boolean(pm && pm.caution),
    pm ? String(pm.caution).slice(0, 48) : 'no pm role');

  /* --- half one: it is not on the choosing screen ------------------------- */
  const step1 = await page.evaluate(() => document.getElementById('cstep-role').innerText);
  check('the limit is NOT on the card where the three options are compared',
    pm && !step1.includes(pm.caution),
    `${step1.length} chars of visible step-1 text`);
  /* Presence before absence: a step-1 sweep that found nothing because the panel
     never rendered would pass the line above for the wrong reason. */
  check('...and that sweep was looking at a real screen',
    pm && step1.includes(pm.label), JSON.stringify(step1.slice(0, 60)));

  /* --- half two: it IS on the last step, for more than one role ----------- */
  /* ⚠️ ONLY THREE RADIOS EXIST (project manager, describe it yourself, pick
     another role), so anything outside the first two is reached through the
     menu -- which is the app's own path, not a shortcut around it. */
  async function pick(role) {
    await page.goto(BASE + '/?tab=create', { waitUntil: 'load' });
    await page.waitForSelector('#pick-pm:not([hidden])', { timeout: 8000 });
    await page.evaluate((key) => {
      if (key === 'pm') { document.getElementById('pick-pm').click(); }
      else {
        document.getElementById('pick-list').click();
        const sel = document.getElementById('rolesel');
        sel.value = key;
        if (sel.value !== key) throw new Error('the menu has no option ' + key);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      document.getElementById('role-next').click();
    }, role.key);
    await page.waitForTimeout(400);
  }

  for (const role of [pm, withLimit.find((r) => r.key !== 'pm')]) {
    await pick(role);
    const seen = await page.evaluate(() => {
      const p = document.getElementById('create-limit');
      const btn = document.getElementById('create-go');
      const vis = (n) => {
        if (!n) return false;
        const r = n.getBoundingClientRect();
        const s = getComputedStyle(n);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && +s.opacity > 0;
      };
      /* 🛑 AND NOTHING IS ON TOP OF IT. Sizes and computed styles say an element
         was LAID OUT, which is not the same as a person being able to read it:
         the first version of this script passed every assertion while the whole
         page sat under an opaque first-run overlay, because a covered paragraph
         still measures 24px tall in the right place. `elementFromPoint` asks the
         only question that matters, which is what is at that spot on screen. */
      let onTop = false;
      if (p && vis(p)) {
        /* ⚠️ SCROLLED TO FIRST. `elementFromPoint` is viewport-relative and
           returns null for a point below the fold, which this paragraph is on a
           1000px-tall window -- so without this the assertion failed on a
           perfectly readable screen AND on a covered one, which is a check that
           reports the same thing either way. */
        p.scrollIntoView({ block: 'center' });
        const r = p.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
        onTop = Boolean(hit) && (hit === p || p.contains(hit));
      }
      return {
        onStep2: !document.getElementById('cstep-name').hidden,
        text: p ? p.textContent : null,
        shown: vis(p),
        onTop,
        limitBottom: p ? p.getBoundingClientRect().bottom : null,
        buttonTop: btn ? btn.getBoundingClientRect().top : null,
      };
    });

    check(`[${role.key}] the last step is the one on screen`, seen.onStep2);
    check(`[${role.key}] the limit is visible there`, seen.shown && seen.text === role.caution,
      JSON.stringify(String(seen.text).slice(0, 56)));
    check(`[${role.key}] and a person can actually see it, with nothing over it`, seen.onTop);
    /* Above the button, not below it: below is after the decision.
       ⚠️ IT REQUIRES THE SENTENCE TO BE THERE FIRST, and that is not belt and
       braces: a hidden paragraph reports a bottom of 0, which is above
       everything, so with the paint removed this line passed while the check
       above it failed. An ordering assertion about an element that is not on
       screen is not a weaker assertion, it is a different one that is always
       true. */
    check(`[${role.key}] it is above the button that creates the agent`,
      seen.shown && seen.limitBottom !== null && seen.buttonTop !== null
        && seen.limitBottom <= seen.buttonTop,
      `shown=${seen.shown} limit ends ${Math.round(seen.limitBottom)}, button starts ${Math.round(seen.buttonTop)}`);
  }

  /* --- and it is hidden, not blank, for a role with no limit -------------- */
  const noLimit = roles.find((r) => !r.caution);
  if (noLimit) {
    await pick(noLimit);
    const box = await page.evaluate(() => {
      const p = document.getElementById('create-limit');
      const r = p.getBoundingClientRect();
      return { h: r.height, hidden: p.hidden };
    });
    /* An empty bordered paragraph still draws a rule down the page, which is why
       this measures the BOX and not the string. */
    check(`[${noLimit.key}] a role with no limit draws nothing`, box.hidden && box.h === 0,
      `hidden=${box.hidden} height=${box.h}`);
  }

  check('no page errors', errors.length === 0, errors.join(' | ').slice(0, 160));

  await browser.close();
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) { failed.forEach((f) => console.log('  - ' + f.name + '  ' + (f.detail || ''))); process.exit(1); }
})().catch((e) => { console.error(e); process.exit(1); });
