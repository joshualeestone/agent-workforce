# Browser checks

`node --test` cannot see the page. These two scripts can.

They are **not part of the test suite** and are not run by `npm test`. They need
a browser, and this repo has no dependencies and is not about to grow one for a
check that runs a few times a release. They live here so the next person can run
exactly what was run, rather than re-deriving it.

## Why they exist

Everything in this directory is here because of defects that the 389 tests in
`node --test` passed over, and could not have caught:

- A modal that rendered **fully transparent**. 316 tests and two blind reviews
  went past it, because nothing had ever put the page on a screen.
- A CSS rule written `.fr-next` instead of `p.fr-next`, which lost to
  `.fr-body p` on specificity and **did nothing at all**. Every text assertion
  matched the file happily.
- The contrast failure hiding underneath that one: 3.04:1 on a 10px caption,
  invisible for as long as the rule was inert. This project's floor is WCAG AA.

The rule they encode: **a test that reads source is testing source.** For
anything about how a screen looks or behaves under a click, render it.

## Running them

```sh
# 1. a server, with every root it writes to pointed somewhere disposable
SB=$(mktemp -d)
PORT=4399 \
  AGENT_WORKFORCE_DATA="$SB/data" \
  AGENT_WORKFORCE_WORKERS="$SB/workers" \
  AGENT_WORKFORCE_LAUNCH="$SB/launch" \
  node server.js &

# 2. playwright, installed OUTSIDE this repo
cd "$(mktemp -d)" && npm init -y && npm i playwright && npx playwright install chromium

# 3. the checks
node <repo>/docs/browser-checks/render-first-run.js /tmp/frshots
node <repo>/docs/browser-checks/click-first-run.js "$SB/data/AgentWorkforce/first-run.json"
```

⚠️ **Sandbox the roots.** `click-first-run.js` drives the real completion flag
through the real route. Run unsandboxed and it writes to
`~/Library/Application Support/AgentWorkforce/`, which is the flag the live
board reads.

⚠️ **Headed by default.** Set `HEADED=0` for a machine with no console session.
Headless renders through SwiftShader rather than the real compositor, so a
paint or geometry result from it is weaker evidence than a headed one.

## What each does

**`render-first-run.js`** opens all nine first-run states in light and dark,
screenshots them into `docs/screenshots/firstrun-*.png`, and measures the
things a text assertion cannot see: that the overlay is opaque and actually
covering, that a click in the middle of the screen lands on it, that every
visible string clears its WCAG AA ratio, that nothing runs off the side, and
that every visible button is focusable and named.

⚠️ **It contains a control, and the control is load-bearing.** The contrast
checker's first version treated `rgba(0,0,0,0.035)` as opaque black and reported
nine failures on a page that had none. Compositing alpha fixed it — and "it
stopped reporting anything" is also what a checker broken into silence looks
like. So it plants one element that genuinely fails and requires itself to catch
it before any clean result below is worth reading.

**`click-first-run.js`** clicks the whole thing like a person: every step, Back,
Skip, Escape, the hand-off into creating an agent, a returning visit, a failing
`/api/first-run`, a failing `/api/machine`, and a completion flag that will not
stick. It asserts against the DOM and the real flag file, never against source.
