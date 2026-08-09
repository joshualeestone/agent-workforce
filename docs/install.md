# From nothing to a working agent

What it actually takes, today, on a clean Mac.

This document is written from the real mechanism on a machine running thirteen
agents, not from how it ought to work. Every path, flag and file below was read
off that machine. Where something is unverified, it says so.

**The headline, before the steps: a total newbie cannot do this today.** The
path is eleven manual steps, three of which are off-machine (a Discord
developer account, an application, a bot invite), one of which is hand-writing
an XML property list, and one of which requires knowing a flag whose name is
`--dangerously-skip-permissions` and whose absence causes a failure that looks
like nothing at all. Counting them honestly is the point of this document. The
product work is collapsing them, and you cannot collapse what you have not
written down.

---

## What you need before step 1

| Thing | Why | Newbie has it? |
|---|---|---|
| A Mac | `launchd` and the launch scripts are macOS-specific | probably |
| A **paid Claude subscription** | the agents run on your own account | maybe |
| Homebrew | to install tmux | no |
| A Discord account | agents are reached through Discord | probably |
| Comfort in Terminal | every step is a command | **no** |

That last row is the real gate. Nothing below has a UI.

---

## The eleven steps

### 1. Install Homebrew

    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

### 2. Install tmux

    brew install tmux

Every agent is a Claude Code process living inside a tmux session. That is what
makes an agent something you can look at, attach to, and restart, rather than a
process that vanishes when a window closes.

### 3. Install Node

    brew install node

Only the board needs this. The agents themselves do not.

### 4. Install Claude Code and sign in

    curl -fsSL https://claude.ai/install.sh | bash
    claude

Sign in when prompted. This is where the subscription is checked.

⚠️ **Note where it landed.** The launch script needs the absolute path, and it
differs between a native install (`~/.local/bin/claude`) and an npm-global one.
Find out now rather than debugging a silent failure later:

    which claude

### 5. Make a Discord application for the agent

Off-machine, in a browser, at the Discord developer portal:

1. New Application, name it after the agent.
2. Bot → add a bot → copy the token.
3. Enable **Message Content Intent**. Without it the bot connects, appears
   online, and never sees a single message.
4. OAuth2 → URL generator → scopes `bot`, permissions Send Messages / Read
   Message History → open the URL → invite it to your server.

⚠️ **One application per agent.** Sharing one bot across several agents means
they cannot be told apart in a channel, and they will answer each other.

⚠️ The token is a credential. It goes in a file at mode `600` in the next step,
never in a repo, never pasted into a chat.

### 6. Give the agent its own channel state directory

    mkdir -p ~/.claude/channels/discord-<agent>
    printf 'DISCORD_BOT_TOKEN=%s\n' '<the token>' > ~/.claude/channels/discord-<agent>/.env
    chmod 600 ~/.claude/channels/discord-<agent>/.env

This directory is what makes one agent a distinct identity: its token, its
channel access list, its inbox.

### 7. Give the agent a working directory and an instruction file

    mkdir -p ~/work/workers/<agent>
    $EDITOR ~/work/workers/<agent>/CLAUDE.md

This file is the whole of the agent's character. It is read once, at start, and
it is the thing the board's instruction editor edits. There is no schema.
Something like:

    # <Agent>

    You are <Agent>. You handle <the thing they handle>.

    ## How you work
    - Ask before sending anything to anyone.
    - Say plainly when you are blocked.

### 8. Write the launch script

    ~/.claude/launch-<agent>-bot.sh

It kills any existing session, starts a new tmux session running Claude Code
with the Discord channel plugin pointed at that agent's state directory, then
waits for the session to end so launchd stays happy:

    #!/bin/bash
    SESSION_NAME="<agent>-discord"
    STATE_DIR="$HOME/.claude/channels/discord-<agent>"
    WORK_DIR="$HOME/work/workers/<agent>"

    /opt/homebrew/bin/tmux kill-session -t "$SESSION_NAME" 2>/dev/null

    /opt/homebrew/bin/tmux new-session -d -s "$SESSION_NAME" -c "$WORK_DIR" \
      "DISCORD_STATE_DIR='$STATE_DIR' $HOME/.local/bin/claude \
       --model claude-opus-5 \
       --channels plugin:discord@claude-plugins-official \
       --dangerously-skip-permissions"

    while /opt/homebrew/bin/tmux has-session -t "$SESSION_NAME" 2>/dev/null; do
      sleep 10
    done

Then `chmod +x` it.

⚠️ **`--dangerously-skip-permissions` is not optional here, and this is the
single worst step in the whole install.** Without it the agent starts, connects,
looks completely healthy, and then freezes forever on the first permission
prompt, which nobody is sitting there to answer. The symptom is an agent that
stops replying with no error anywhere. A newbie has no chance of diagnosing
that, and the flag is named to discourage exactly the person who must use it.

⚠️ The session name **must** end in `-discord`. The board's roster and every
one of its safety checks key on that suffix.

### 9. Write the launchd plist

    ~/Library/LaunchAgents/com.<agent>.discord.plist

Hand-written XML. `KeepAlive` is what restarts the agent if it dies;
`ThrottleInterval` stops a crash loop spinning; `EnvironmentVariables` is
required because launchd does not inherit your shell's `PATH`, and without it
the script cannot find tmux.

    <?xml version="1.0" encoding="UTF-8"?>
    <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
      "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
    <plist version="1.0">
    <dict>
      <key>Label</key><string>com.<agent>.discord</string>
      <key>ProgramArguments</key>
      <array>
        <string>/bin/bash</string>
        <string>/Users/<you>/.claude/launch-<agent>-bot.sh</string>
      </array>
      <key>RunAtLoad</key><true/>
      <key>KeepAlive</key><true/>
      <key>ThrottleInterval</key><integer>30</integer>
      <key>StandardOutPath</key>
      <string>/Users/<you>/.claude/logs/<agent>-discord.log</string>
      <key>StandardErrorPath</key>
      <string>/Users/<you>/.claude/logs/<agent>-discord.err.log</string>
      <key>EnvironmentVariables</key>
      <dict>
        <key>HOME</key><string>/Users/<you></string>
        <key>PATH</key>
        <string>/Users/<you>/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
      </dict>
    </dict>
    </plist>

⚠️ `~` does not expand in a plist. Every path must be absolute and literal.
This is a silent failure: the agent simply never starts.

    mkdir -p ~/.claude/logs

### 10. Start it

    launchctl load ~/Library/LaunchAgents/com.<agent>.discord.plist

### 11. Check it actually worked

Three checks, because each one fails differently:

    tmux has-session -t <agent>-discord && echo "session is up"
    tail -20 ~/.claude/logs/<agent>-discord.err.log
    # then say something in the Discord channel and see if it answers

A session that is up but silent in Discord is usually the Message Content Intent
from step 5, or a frozen permission prompt from step 8.

---

## Then, optionally, the board

    git clone <this repo> && cd agent-workforce
    node server.js
    # open http://127.0.0.1:4317

No install, no dependencies, no build. It reads what is already running.

⚠️ **Restart will not work until you add one more file.** The board shells out
to `~/.claude/bin/restart-bot.sh` and refuses if it is not there, because the
alternative — killing the tmux session and starting a new one — silently drops
`--dangerously-skip-permissions` and brings the agent back frozen (step 8). None
of the eleven steps above creates that script, so a board installed by following
this document to the letter answers "the restart script is not on this machine"
every time. Compact and Clear work; Restart does not.

    mkdir -p ~/.claude/bin
    cat > ~/.claude/bin/restart-bot.sh <<'SH'
    #!/bin/bash
    # Restart one agent THROUGH launchd, so the launch script's flags are applied.
    set -e
    BOT="$1"
    [ -z "$BOT" ] && { echo "usage: restart-bot.sh <agent>"; exit 1; }
    # ⚠️ Absolute, for the same reason step 9's plist sets PATH: this runs from
    # launchd and from the board, neither of which inherits your shell's PATH.
    # A bare `tmux` here fails, the script takes the "did not come back" branch,
    # and the board tombstones the commitments of an agent that returned
    # perfectly healthy.
    TMUX_BIN="${TMUX_BIN:-/opt/homebrew/bin/tmux}"
    if [ ! -x "$TMUX_BIN" ]; then TMUX_BIN="$(command -v tmux || true)"; fi
    if [ -z "$TMUX_BIN" ]; then echo "Error: No launchd service found for '$BOT'"; exit 1; fi
    PLIST="$HOME/Library/LaunchAgents/com.$BOT.discord.plist"
    if [ ! -f "$PLIST" ]; then echo "Error: No launchd service found for '$BOT'"; exit 1; fi
    launchctl stop "com.$BOT.discord" 2>/dev/null || true
    launchctl start "com.$BOT.discord"
    sleep 8
    if $TMUX_BIN has-session -t "$BOT-discord" 2>/dev/null; then
      echo "OK: $BOT-discord tmux session is running"
    else
      echo "Error: $BOT-discord did not come back"; exit 1
    fi
    if $TMUX_BIN capture-pane -p -t "$BOT-discord" -S -50 | grep -q "bypass permissions"; then
      echo "OK: bypass permissions is ON"
    else
      echo "WARN: bypass permissions not confirmed yet"
    fi
    SH
    chmod +x ~/.claude/bin/restart-bot.sh

⚠️ **If tmux cannot be found, this exits down the "no service" path on
purpose.** The obvious `[ -x "$X" ] || X=$(command -v tmux)` is wrong under
`set -e`: when tmux is genuinely absent the assignment fails, the script exits
non-zero having printed nothing, and the board reads that as "we asked and
cannot confirm" — which tombstones the commitment record of an agent nobody
touched. Of the two things this script can say, only the missing-service message
is understood as "we did not attempt it".

⚠️ **This is a minimal reconstruction, not a copy of the fleet's script.** The
one on this machine differs (different sleep pattern, and it warns rather than
failing when the session does not return). What matters is the contract below,
not the implementation.

⚠️ The two `OK:` lines are not decoration. The board parses for **both** before
it will report a restart as done, precisely so it cannot tell you an agent came
back healthy when it came back without its permissions flag and is about to
freeze. If you change this script, keep those strings.

**So it is twelve steps, not eleven, if you want the board's Restart button.**
Counted honestly rather than filed under "optional".

---

## Where a newbie actually fails

Ranked by how likely, and how badly the failure hides itself:

1. **The missing permissions flag** (step 8). Agent looks perfectly healthy and
   answers nothing. No error is written anywhere. Worst failure in the install.
2. **Message Content Intent off** (step 5). Bot is online in the member list and
   ignores every message. Nothing local shows a problem.
3. **A `~` in the plist** (step 9). Agent never starts, no error surfaces to the
   user, and `launchctl` reports success.
4. **The wrong `claude` path** (step 4/8). Only visible in a log file nobody has
   been told to look at.
5. **The session not ending in `-discord`** (step 8). The agent runs fine and is
   invisible to the board, which reads as the board being broken.

Every one of these presents as *silence*, and four of the five leave no error
message anywhere the user would look. That is the real usability finding here:
this install has no failure it tells you about.

---

## What the product has to do about it

Not a roadmap, just what falls out of the list above.

- **Steps 6 to 11 are mechanical** and should be one command: given a name and a
  token, write the state dir, the CLAUDE.md, the launch script and the plist,
  load it, and verify. Nothing in those six steps requires a human decision.
- **Step 11 should not be a thing the user remembers to do.** The three checks
  are exactly what the board already computes. "Add an agent" should end by
  showing it running, or saying which of the five failures above occurred.
- **The permissions flag should not be the user's problem.** It is required for
  every unattended agent; anything generating a launch script should always
  include it and explain why, rather than expecting someone to know.
- **Step 5 cannot be automated** (it is Discord's browser flow) but it can be
  walked through, and Message Content Intent can be *verified* afterwards rather
  than left to fail silently.

Realistically that is eleven steps down to three: install Claude Code, make a
Discord app, run one command.

---

## Not verified

Stated separately rather than folded in as though it were known:

- **Linux.** Everything here is macOS. The tmux and Claude Code parts are
  portable; `launchd` is not, and the systemd equivalent has not been written or
  tested.
- **The minimum Node version** for the board. It is developed on Node 25 and
  uses `node --test` and `node:` prefixed requires; the true floor has not been
  established by testing older runtimes.
- **Whether a fresh Discord application still defaults Message Content Intent to
  off.** True when this fleet's applications were created; Discord changes that
  portal regularly, and it has not been re-checked against a brand new app.
