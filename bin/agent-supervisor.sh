#!/bin/bash
#
# Start one agent, and keep launchd from restarting it in a loop.
#
# ⚠️ ONE FILE, SHARED BY EVERY AGENT, and that is the whole point of it.
#
# This used to be generated per agent: each one got its own 151-line copy under
# its own folder. Every defect in it therefore shipped as many times as there
# were agents, and every FIX reached only the agents created afterwards — the
# ones already on the machine kept their copy of the bug forever. It also could
# not be reviewed once: it was reviewed per generation, which is how six
# separate defects got into it across one afternoon.
#
# Now it takes the agent as arguments and is installed once, so a change here
# reaches every agent the next time it starts.
#
# Usage, which is what the launchd job runs:
#
#   agent-supervisor.sh <session> <workdir> <claude-bin> <tmux-bin> [log]
#
# ⚠️ The arguments are NOT validated here, deliberately. `engine/create.js`
# validates the name once, hard, before anything is written — the same name that
# becomes a directory, a service label and a tmux session — and a second, weaker
# copy of that rule here would be exactly the two-definitions-of-one-fact defect
# this codebase keeps paying for. What this file must do instead is never
# interpolate an argument into anything that reinterprets it: every use below is
# a quoted "$1"-style expansion passed as one argument.

set -u

SESSION="${1:?an agent name is required}"
WORKDIR="${2:?a working directory is required}"
CLAUDE="${3:?the path to claude is required}"
TMUX_BIN="${4:?the path to tmux is required}"
LOG="${5:-}"

# ⚠️ TWO SPELLINGS OF THE SAME SESSION, and which commands take which was
# MEASURED on tmux 3.6a rather than assumed, because assuming it broke the claim
# on a real agent:
#
#   has-session, kill-session,
#   list-panes                : accept "=name" (exact) -- USE IT. Their default
#                               resolution falls back to a PREFIX match, so
#                               "kill-session -t sam" will happily kill
#                               samantha-discord. Measured, by killing one.
#   set-option, show-options  : REJECT "=name" outright ("no such session:
#                               =name"). They take the plain name.
#
# The two plain-name commands prefix-match too, but both run only when an exact
# session of this name is known to exist -- inside the loop that has-session
# guarded, or after new-session made it -- and tmux prefers an exact match over
# a prefix. Also measured.
TARGET="=$SESSION"

say() {
  # launchd captures stderr to the agent's log; a run by hand shows it on screen.
  echo "$(date): $*" >&2
}

# launchd appends to that log forever, and a persistently failing start writes a
# line every 30 seconds for as long as the machine is on. Keep it bounded.
if [ -n "$LOG" ] && [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1048576 ]; then
  : > "$LOG"
fi

# ── the session ──────────────────────────────────────────────────────────────
#
# ⚠️ Only ever clear a session that is OURS.
#
# This runs at every login and after every crash, so a person who happened to
# have a tmux session of this name would have had it destroyed by a job
# installed weeks earlier. The board refuses to act on any pane it cannot tie to
# a name; a script that kills one is that rule broken from the outside.
#
# The claim is the tie. If something else holds the name we WAIT rather than
# exit: exiting would have launchd restart us every 30 seconds, and waiting
# recovers on its own the moment that session ends.
adopt=
warned=0
while "$TMUX_BIN" has-session -t "$TARGET" 2>/dev/null; do
  if [ "$("$TMUX_BIN" show-options -t "$SESSION" -v @kosmos_agent 2>/dev/null)" = "$SESSION" ]; then
    # Ours -- but do not throw away a HEALTHY one. This file can be run by hand,
    # and an unconditional kill meant doing so destroyed the live agent and
    # everything it remembered.
    #
    # ⚠️ IF WE CANNOT SEE INSIDE IT, WE DO NOT TOUCH IT. An empty answer used to
    # mean "every pane is a shell", so a tmux that failed to answer became a
    # reason to destroy a session we had just confirmed is ours -- "I cannot see
    # it" converted into "it is dead", which is the one inversion this whole
    # codebase is written against.
    #
    # ⚠️ -s, so this asks about the whole SESSION. Without it tmux resolves the
    # target as a WINDOW, so a split window or a second window with a shell in
    # it read as "crashed" and the live agent was killed at the next login.
    panes=$("$TMUX_BIN" list-panes -s -t "$TARGET" -F '#{pane_current_command}' 2>/dev/null)
    if [ -z "$panes" ]; then
      say "could not read what is running in $SESSION -- leaving it alone"
      adopt=1
      break
    fi
    alive=0
    while read -r pane_cmd; do
      # ⚠️ AN ALLOWLIST, matching status.js's isClaudeCommand, NOT a list of
      # shells to exclude. A crashed agent whose remaining pane holds vim, less,
      # ssh or python3 is not Claude, but a denylist of six shell names says it
      # is -- so the script adopts a dead agent and sits in the supervision loop
      # forever, and launchd's KeepAlive can never recover it because the job
      # looks healthy.
      #
      # ⚠️ A REGEX, not a glob: the glob [0-9]*.[0-9]*.[0-9]* also matches
      # 1.2.3.4 and 1a.2b.3c, while status.isNativeClaude is exactly three
      # numeric segments. A looser copy of a definition, beside a comment
      # claiming they are the same, in the place where being loose means
      # supervising a dead agent forever.
      if [[ "$pane_cmd" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] \
        || [ "$pane_cmd" = claude ] || [ "$pane_cmd" = claude.exe ] || [ "$pane_cmd" = node ]; then
        alive=1
      fi
    done <<EOF
$panes
EOF
    if [ "$alive" -eq 1 ]; then
      say "$SESSION is already running -- leaving it alone and watching it"
      adopt=1
      break
    fi
    # Every pane is a shell: it crashed. Replace it.
    "$TMUX_BIN" kill-session -t "$TARGET" 2>/dev/null
    break
  fi
  if [ "$warned" -eq 0 ]; then
    say "a session called $SESSION is already running and is not ours -- waiting rather than killing it"
    warned=1
  fi
  sleep 5
done

# --dangerously-skip-permissions is not optional for an unattended agent.
# Without it the agent starts, looks healthy, and freezes forever on its first
# permission prompt with nobody there to answer it.
#
# ⚠️ Exit on failure, because the claim below must never land on a session we
# did not make. The name can be taken between the check above and this line, and
# stamping @kosmos_agent onto somebody else's session would make the NEXT run of
# this script recognise it as ours and kill it.
if [ -z "$adopt" ]; then
  "$TMUX_BIN" new-session -d -s "$SESSION" -c "$WORKDIR" \
    "$CLAUDE" --dangerously-skip-permissions || exit 1
fi

# The claim. Without it this agent is anonymous on the board after every
# restart, whatever it was when it was created: no name, no role, no model, and
# no editable instructions. It is a tmux user option, so it dies with the
# session -- which is exactly why it is trustworthy, and exactly why it has to
# be set at every start rather than once at creation.
"$TMUX_BIN" set-option -t "$SESSION" @kosmos_agent "$SESSION" \
  || say "could not claim $SESSION -- the board will not recognise it"

# Stay alive while the session does, so launchd supervises the AGENT rather than
# a command that exits in a tenth of a second.
#
# ⚠️ Without this the job "finishes" immediately, KeepAlive restarts it, and the
# restart fails on the session the last run just made: a respawn loop for as
# long as the machine is on, while the agent looks perfectly healthy because the
# first attempt worked.
while "$TMUX_BIN" has-session -t "$TARGET" 2>/dev/null; do
  sleep 10
done
