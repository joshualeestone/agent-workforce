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
 * Per-model context limits, in tokens.
 *
 * Evidenced, not assumed. Across eight separate opus-4-8 sessions on this
 * machine the window peaks at 999,173 / 999,076 / 998,545 / 998,022 and so on,
 * clustering just under 1,000,000 and never crossing it. That is a 1M window
 * showing itself repeatedly.
 *
 * An earlier version of this file hardcoded 200,000, which was inferred from
 * the largest number seen at the time rather than from evidence. A ring
 * calibrated to it would have put a real agent at 406% and pegged it full
 * forever.
 *
 * A second attempt tried to learn each agent's ceiling from its own history.
 * That was worse and it was visibly worse: for a session still growing, the
 * highest value it has reached IS roughly its current value, so every agent
 * rendered at 100%. Cleverness that produces a uniformly wrong answer is just
 * a slower way to be wrong.
 *
 * Limits are per-model and must stay that way. A Haiku agent genuinely does
 * have a 200k window, so a single global constant would be wrong again in the
 * other direction.
 */
const CONTEXT_LIMITS = {
  'claude-opus-4-8': 1000000, // observed: 8 sessions peaking 996k-999k
};

/**
 * Models we have not directly watched hit their ceiling.
 *
 * Every current-generation model observed here is consistent with 1M and none
 * contradicts it, so this is applied as a labelled assumption rather than
 * withheld. The UI marks it: an assumed denominator is fine to show as long as
 * nobody is told it was measured.
 */
const ASSUMED_LIMIT = 1000000;
const ASSUMED_LIMIT_MODELS = /^claude-(opus|sonnet|fable)-/;

function limitFor(model) {
  if (!model) return null;
  if (CONTEXT_LIMITS[model]) return { limit: CONTEXT_LIMITS[model], assumed: false };
  const undated = model.replace(/-\d{8}$/, '');
  if (CONTEXT_LIMITS[undated]) return { limit: CONTEXT_LIMITS[undated], assumed: false };
  if (ASSUMED_LIMIT_MODELS.test(model)) return { limit: ASSUMED_LIMIT, assumed: true };
  return null;
}

const REGISTRY_DIR = path.join(HOME, '.claude', 'agent-registry');

/**
 * Find the transcript belonging to an agent's CURRENT session.
 *
 * The obvious approach -- guess a project directory from the agent's name --
 * silently reads the wrong file. Claude Code creates a project directory per
 * working directory, agents move between directories, and one agent can
 * therefore own transcripts in several places while another agent's directory
 * looks like a plausible match for a name it does not own. That failure is the
 * dangerous kind: it finds *a* transcript, so it looks like it worked, and
 * reports confident numbers from the wrong session.
 *
 * The registry records each agent's live `session_id`, and a transcript is
 * named for its session id. That is an exact identity, not a resemblance, so
 * we resolve by it and search every project directory for the file.
 */
function sessionIdFor(sessionName) {
  const file = path.join(REGISTRY_DIR, `${sessionName}-discord_0.0.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')).session_id || null;
  } catch {
    return null;
  }
}

function transcriptFor(agentName) {
  const sessionId = sessionIdFor(agentName);
  let dirs;
  try {
    dirs = fs.readdirSync(PROJECTS_DIR);
  } catch {
    return null;
  }

  if (sessionId) {
    for (const d of dirs) {
      const candidate = path.join(PROJECTS_DIR, d, `${sessionId}.jsonl`);
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  // No registry entry, or its session has gone. We deliberately do NOT fall
  // back to guessing by name: a wrong transcript produces confident numbers
  // about the wrong conversation, which is worse than no numbers at all.
  return null;
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

  const found = limitFor(model);
  const ceiling = found && found.limit;

  if (!ceiling) {
    return {
      tokens,
      percent: null,
      ceiling: null,
      ceilingSource: null,
      confidence: CONFIDENCE.STRUCTURED,
      because: `measured, but we do not know how much ${model || 'this model'} can hold`,
    };
  }

  const percent = Math.round((tokens / ceiling) * 100);
  return {
    tokens,
    percent: Math.min(100, percent),
    overCeiling: percent > 100,
    ceiling,
    ceilingAssumed: found.assumed,
    confidence: CONFIDENCE.STRUCTURED,
    because: found.assumed
      ? 'measured, against a limit we have assumed rather than watched'
      : 'measured, against a limit we have watched it hit',
  };
}

/**
 * Model IDs as a person should read them.
 *
 * An explicit table, not a transform. A dash-to-space rule looks fine on
 * `claude-opus-5` and then ships a visible bug on `claude-haiku-4-5`, which
 * would render "Haiku 4 5" when the last two segments are a decimal. Version
 * numbers are not word separators.
 *
 * We deliberately do not ask the Models API for display names, even though it
 * has this exact field: that call needs an API key, and the rule the whole cost
 * model rests on is that this platform never talks to the API directly. Not
 * worth breaking for a label.
 *
 * An ID we do not recognise renders raw. New models ship often, and an
 * unfamiliar accurate name beats a confident wrong one -- the same rule the
 * status board follows.
 */
const MODEL_NAMES = {
  'claude-opus-5': 'Claude Opus 5',
  'claude-sonnet-5': 'Claude Sonnet 5',
  'claude-fable-5': 'Claude Fable 5',
  'claude-opus-4-8': 'Claude Opus 4.8',
  'claude-haiku-4-5': 'Claude Haiku 4.5',
};

function modelDisplayName(id) {
  if (!id) return null;
  if (MODEL_NAMES[id]) return MODEL_NAMES[id];
  // Dated IDs (…-20251001) are the same model with a snapshot suffix.
  const undated = id.replace(/-\d{8}$/, '');
  if (MODEL_NAMES[undated]) return MODEL_NAMES[undated];
  return id;
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

/**
 * Who the agent actually is, as opposed to what the machine calls it.
 *
 * `claudebot` is Splinter. `angel` is Angel Bridge. The tmux session name is an
 * infrastructure identifier and showing it to a person is a small lie of
 * omission -- it is the name of a process, not the name of a colleague.
 *
 * On this fleet the real name lives in the agent's own instruction file, which
 * is fitting: that file is the source of truth for who the agent is, and it is
 * the same file the agent-detail screen is built around. In the product proper
 * this is just a field somebody typed when they created the agent.
 *
 * Where it cannot be derived we show the raw session name and say so, rather
 * than inventing something friendlier.
 */
const WORKERS_DIR = path.join(HOME, 'work', 'workers');

/**
 * Explicit overrides for agents whose identity is not derivable.
 *
 * Convention holds for twelve of the thirteen here. The thirteenth predates the
 * convention and is inconsistent at every layer: tmux says `claudebot-discord`,
 * its launch script is `launch-discord-bot.sh`, its config dir is
 * `channels/discord`, its launchd job is `com.claudebot.discord`, and the person
 * using it calls it Splinter. Five identifiers, none of them "splinter".
 *
 * Deriving from any single layer produces a confident wrong answer -- the config
 * dir would name it "discord". So exceptions are listed, not inferred. In the
 * product proper this whole file collapses into a field somebody typed.
 */
const IDENTITY_OVERRIDES = {
  claudebot: { displayName: 'Splinter', role: 'Project Manager' },
};

function readIdentity(sessionName) {
  const override = IDENTITY_OVERRIDES[sessionName];
  if (override) return { ...override, derived: true, source: 'override' };

  const file = path.join(WORKERS_DIR, sessionName, 'CLAUDE.md');
  let text;
  try {
    text = fs.readFileSync(file, 'utf8').slice(0, 4000);
  } catch {
    return { displayName: sessionName, role: null, derived: false };
  }

  const m = text.match(/You are \*\*([^*]+)\*\*(?:\s*\(([^)]+)\))?\s*,?\s*([^.\n]*)/);
  if (!m) return { displayName: sessionName, role: null, derived: false };

  const displayName = m[1].trim();
  let role = (m[3] || '')
    .replace(/\*\*/g, '')          // instruction files are markdown; strip emphasis
    .replace(/^(the|a|an)\s+/i, '')
    .replace(/^Josh Stone's\s+/i, '')
    .split(/\s+in the\s+|,/)[0]
    .trim();
  if (role.length > 60) role = role.slice(0, 60).trim();

  return { displayName, role: role || null, derived: true };
}

function snapshot() {
  const panes = listPanes();
  const agents = panes.map((pane) => {
    const text = capturePane(pane.target);
    const status = classify(pane, text);
    const { model } = readModel(pane.name);
    const context = readContext(pane.name, model);
    const identity = readIdentity(pane.name);
    return {
      name: identity.displayName,
      sessionName: pane.name,
      nameDerived: identity.derived,
      role: identity.role,
      target: pane.target,
      task: taskLine(pane.title),
      state: status.state,
      stateConfidence: status.confidence,
      because: status.because,
      context,
      model,
      modelName: modelDisplayName(model),
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

module.exports = { snapshot, classify, modelDisplayName, readIdentity, STATE, CONFIDENCE, CONTEXT_LIMITS };

if (require.main === module) {
  process.stdout.write(JSON.stringify(snapshot(), null, 2) + '\n');
}
