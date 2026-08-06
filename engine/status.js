'use strict';

/**
 * Status engine.
 *
 * Derives the state of every agent on this machine. Read-only: it runs tmux
 * queries and reads files, and never writes, sends keys, or starts anything.
 *
 * The one rule that shapes the whole file: an agent we cannot read must come
 * out as `unknown`, never as something healthy. Most monitoring bugs are the
 * same shape -- the check cannot tell "fine" from "I can't see it" and renders
 * green. Every field here therefore carries how it was determined, so the UI
 * can show confidence rather than implying certainty it does not have.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOME = os.homedir();
const PROJECTS_DIR = path.join(HOME, '.claude', 'projects');

// How the value was arrived at. The UI renders low-confidence values
// differently, and never renders `none` as a real number.
const CONFIDENCE = {
  STRUCTURED: 'structured', // read from a file written for this purpose
  SCRAPED: 'scraped',       // read off a terminal pane; may be UI chrome
  NONE: 'none',             // could not determine -- must not render as a value
};

const STATE = {
  WORKING: 'working',
  NEEDS_YOU: 'needs_you',
  RATE_LIMITED: 'rate_limited',
  IDLE: 'idle',
  STOPPED: 'stopped',
  UNKNOWN: 'unknown', // the default, deliberately
};

function sh(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', timeout: 5000 });
  } catch {
    return null;
  }
}

/** Every agent pane on the machine, by tmux session name. */
function listPanes() {
  const fmt = '#{session_name}\t#{window_index}.#{pane_index}\t#{pane_current_command}\t#{pane_title}';
  const out = sh('tmux', ['list-panes', '-a', '-F', fmt]);
  if (!out) return [];
  return out.trim().split('\n').filter(Boolean).map((line) => {
    const [session, pane, command, ...titleParts] = line.split('\t');
    return {
      name: session.replace(/-discord$/, ''),
      target: `${session}:${pane}`,
      command: command || '',
      title: titleParts.join('\t') || '',
    };
  });
}

function capturePane(target, lines = 40) {
  return sh('tmux', ['capture-pane', '-p', '-t', target, '-S', `-${lines}`]);
}

/**
 * Is a Claude process running in this pane at all?
 *
 * pane_current_command reports a version string ("2.1.222") when Claude Code
 * is running, and a shell name when it is not. That distinguishes running from
 * stopped and nothing else -- it cannot tell working from idle from blocked.
 */
const SHELLS = new Set(['zsh', 'bash', 'fish', 'sh', 'tmux', 'login']);
function isClaudeRunning(command) {
  if (!command) return false;
  return !SHELLS.has(command.trim());
}

/**
 * Braille spinner frames. Claude Code animates these in the pane title while
 * it is actively producing output, so their presence is a live "working"
 * signal. Their absence is NOT evidence of idleness -- we may simply have
 * sampled between frames.
 */
const SPINNER = /[⠀-⣿]/;

const NEEDS_YOU_MARKERS = [
  /Do you want to proceed/i,
  /Would you like to/i,
  /\bAllow\b.*\?/,
  /permission to/i,
  /❯\s*1\.\s*Yes/,
];

const RATE_LIMIT_MARKERS = [
  /rate limit/i,
  /usage limit/i,
  /\b429\b/,
  /try again (later|at)/i,
];

/**
 * Classify one pane.
 *
 * Ordered most-certain first. Anything that does not match a rule falls
 * through to UNKNOWN on purpose; that is the honest answer and it is what
 * stops the board reporting health it has not verified.
 */
function classify(pane, paneText) {
  if (!isClaudeRunning(pane.command)) {
    return { state: STATE.STOPPED, confidence: CONFIDENCE.STRUCTURED, because: 'no Claude process in this pane' };
  }
  if (paneText === null) {
    return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'could not read this pane' };
  }

  const tail = paneText.split('\n').slice(-25).join('\n');

  if (RATE_LIMIT_MARKERS.some((re) => re.test(tail))) {
    return { state: STATE.RATE_LIMITED, confidence: CONFIDENCE.SCRAPED, because: 'the pane mentions a usage limit' };
  }
  if (NEEDS_YOU_MARKERS.some((re) => re.test(tail))) {
    return { state: STATE.NEEDS_YOU, confidence: CONFIDENCE.SCRAPED, because: 'the pane is showing a question' };
  }
  if (SPINNER.test(pane.title)) {
    return { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is producing output right now' };
  }
  if (/esc to interrupt/i.test(tail)) {
    return { state: STATE.WORKING, confidence: CONFIDENCE.SCRAPED, because: 'it is mid-task' };
  }
  if (/✱|Worked for|Brewed for|Baked for|to save .* tokens/i.test(tail)) {
    return { state: STATE.IDLE, confidence: CONFIDENCE.SCRAPED, because: 'it finished and is waiting for you' };
  }

  return { state: STATE.UNKNOWN, confidence: CONFIDENCE.NONE, because: 'nothing in the pane says what it is doing' };
}

/** The task line Claude Code keeps in the pane title, stripped of glyphs. */
function taskLine(title) {
  const cleaned = (title || '').replace(SPINNER, '').replace(/^[✀-➿\s]+/, '').trim();
  return cleaned || null;
}

/**
 * Current context-window fill, from the session transcript.
 *
 * Deliberately NOT the pane's "/clear to save Nk tokens" figure. That one is
 * cumulative session tokens: it only ever grows, so a ring driven by it would
 * fill once and never empty, and could never show the reset that is the entire
 * point of showing it. This is per-turn window occupancy, which oscillates and
 * therefore actually predicts a reset.
 */
/**
 * Per-model context limits.
 *
 * Deliberately empty. An earlier draft hardcoded 200,000 and was wrong: this
 * fleet has been observed running at 499,849 tokens (opus-5) and 715,408
 * (fable-5) without resetting, so the real ceiling is well past that and we do
 * not have a trustworthy source for it yet.
 *
 * Rather than guess, we report the token count -- which is measured and
 * defensible -- and report `percent: null` with a reason. That is the same
 * rule the rest of the engine follows: a number we cannot stand behind is
 * worse than an honest gap, because a wrong percentage on a ring would be
 * believed. Fill this in once the limit is verified, not inferred from
 * whatever the highest number we happened to see was.
 */
const CONTEXT_LIMITS = Object.create(null);

function transcriptFor(agentName) {
  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return null;
  }
  const match = dirs.find((d) => d.endsWith(`-workers-${agentName}`)) ||
                dirs.find((d) => d.includes(agentName));
  if (!match) return null;

  const dir = path.join(PROJECTS_DIR, match);
  let files;
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
  } catch {
    return null;
  }
  if (!files.length) return null;

  const newest = files
    .map((f) => {
      const p = path.join(dir, f);
      return { p, mtime: fs.statSync(p).mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime)[0];
  return newest.p;
}

/** Read the tail of a file without loading all of it. Transcripts reach 8MB+. */
function tailBytes(file, bytes = 262144) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(Math.min(bytes, size));
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* ignore */ }
  }
}

function readContext(agentName, model) {
  const file = transcriptFor(agentName);
  if (!file) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, because: 'no transcript found' };
  }
  const text = tailBytes(file);
  if (!text) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, because: 'could not read the transcript' };
  }

  const usages = [...text.matchAll(/"usage":\{([^}]*)\}/g)];
  if (!usages.length) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, because: 'no usage data in the transcript' };
  }

  const num = (blob, key) => {
    const m = blob.match(new RegExp(`"${key}":(\\d+)`));
    return m ? Number(m[1]) : 0;
  };
  const last = usages[usages.length - 1][1];
  const tokens = num(last, 'input_tokens') +
                 num(last, 'cache_creation_input_tokens') +
                 num(last, 'cache_read_input_tokens');

  if (!tokens) {
    return { tokens: null, percent: null, confidence: CONFIDENCE.NONE, because: 'usage data was empty' };
  }

  const limit = model ? CONTEXT_LIMITS[model] : undefined;
  if (!limit) {
    // The count is real and measured; the proportion is not knowable yet.
    // Report the first, refuse the second, and say which is which.
    return {
      tokens,
      percent: null,
      limit: null,
      confidence: CONFIDENCE.STRUCTURED,
      because: `measured, but we do not know ${model || 'this model'}'s limit, so we cannot say how full it is`,
    };
  }
  return {
    tokens,
    percent: Math.min(100, Math.round((tokens / limit) * 100)),
    limit,
    confidence: CONFIDENCE.STRUCTURED,
    because: 'measured from this session',
  };
}

function readModel(agentName) {
  const file = transcriptFor(agentName);
  if (!file) return { model: null, confidence: CONFIDENCE.NONE };
  const text = tailBytes(file, 65536);
  if (!text) return { model: null, confidence: CONFIDENCE.NONE };
  const matches = [...text.matchAll(/"model":"([^"]+)"/g)];
  if (!matches.length) return { model: null, confidence: CONFIDENCE.NONE };
  return { model: matches[matches.length - 1][1], confidence: CONFIDENCE.STRUCTURED };
}

function snapshot() {
  const panes = listPanes();
  const agents = panes.map((pane) => {
    const text = capturePane(pane.target);
    const status = classify(pane, text);
    const { model } = readModel(pane.name);
    const context = readContext(pane.name, model);
    return {
      name: pane.name,
      target: pane.target,
      task: taskLine(pane.title),
      state: status.state,
      stateConfidence: status.confidence,
      because: status.because,
      context,
      model,
    };
  });

  agents.sort((a, b) => a.name.localeCompare(b.name));

  return {
    // Freshness is not decoration. An ambient display gets trusted passively,
    // and silence from it reads as "all fine". If this poller dies, the UI can
    // show the stamp going stale instead of freezing on a happy picture.
    checkedAt: new Date().toISOString(),
    counts: {
      total: agents.length,
      needsYou: agents.filter((a) => a.state === STATE.NEEDS_YOU).length,
      unknown: agents.filter((a) => a.state === STATE.UNKNOWN).length,
      unreadableTokens: agents.filter((a) => a.context.tokens === null).length,
      unknownFullness: agents.filter((a) => a.context.percent === null).length,
    },
    agents,
  };
}

module.exports = { snapshot, classify, STATE, CONFIDENCE, CONTEXT_LIMITS };

if (require.main === module) {
  process.stdout.write(JSON.stringify(snapshot(), null, 2) + '\n');
}
