'use strict';

/**
 * The kosmos command as THIS machine can actually run it.
 *
 * ⚠️ Bare `kosmos` was a lie on every stock install: the installer links
 * the CLI into ~/.local/bin, which is not on a default macOS PATH, so the
 * taught command failed with "command not found" in every agent's shell --
 * silently, because the engine is never reached and no refusal row can
 * exist (2026-08-18, Josh's machine; the person hit the identical wall in
 * their own terminal minutes earlier).
 *
 * Layouts, probed rather than assumed, most specific first:
 *   installed   this file lives at $KOSMOS_HOME/app/engine; the CLI is
 *               $KOSMOS_HOME/bin/kosmos (stable across updates -- an
 *               update swaps app/, not bin/).
 *   source      this file lives at <repo>/engine; the CLI is
 *               <repo>/install/kosmos.
 * Neither provable: fall back to bare `kosmos` rather than inventing a
 * path we did not verify. `probeRoot` exists for tests.
 */

const fs = require('node:fs');
const path = require('node:path');

function kosmosCli(probeRoot) {
  const installedHome = probeRoot || path.resolve(__dirname, '..', '..');
  if (fs.existsSync(path.join(installedHome, 'bin', 'kosmos'))
   && fs.existsSync(path.join(installedHome, 'app', 'server.js'))) {
    return path.join(installedHome, 'bin', 'kosmos');
  }
  const sourceRoot = probeRoot || path.resolve(__dirname, '..');
  const sourceCli = path.join(sourceRoot, 'install', 'kosmos');
  if (fs.existsSync(sourceCli)) return sourceCli;
  return 'kosmos';
}

/** The taught form: double-quoted only when the path carries whitespace,
    because the agent pastes this line into a shell. */
function kosmosCliShown(probeRoot) {
  const cli = kosmosCli(probeRoot);
  return /\s/.test(cli) ? '"' + cli + '"' : cli;
}

module.exports = { kosmosCli, kosmosCliShown };
