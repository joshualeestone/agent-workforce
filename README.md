# Agent Workforce (working name)

A small team of agents that runs on your own computer, under your own
Claude subscription.

## Status: Phase 1

It shows you what the agents on this machine are doing, and it can now change
some of what they are: their picture, what you call their job, and the
instruction file each one reads when it starts.

**It can also make one.** Pick what the agent is for, give it a name, and it
writes the folder, the instructions, a startup script and a launchd job, loads
the job, and then WATCHES THE BOARD until it can see the agent running before it
says so. No terminal, and nothing claimed that was not observed: if the board
cannot see it after thirty seconds, the screen says that instead.

It cannot stop, remove or message an agent yet.

⚠️ **Removing one is still a manual job, and it matters more than the others**,
because a created agent has a launchd job that starts it at every login. Deleting
its folder is not enough — the job would keep trying. Until Remove is built:

    launchctl bootout gui/$UID/com.kosmos.agent.<name>
    rm ~/Library/LaunchAgents/com.kosmos.agent.<name>.plist
    tmux kill-session -t "=<name>"
    rm -rf ~/work/workers/<name>

The `=` is not a typo. Without it tmux resolves a target by PREFIX, so
`kill-session -t sam` will happily kill `samantha-discord` if no session is
called exactly `sam`. If you started the board with `AGENT_WORKFORCE_WORKERS` or
`AGENT_WORKFORCE_LAUNCH` set, substitute those paths for the two above.

The startup script refuses to touch a session it cannot prove is its own, so a
leftover job cannot take a name somebody else is using — but it will sit there
waiting, which is its own kind of surprise.

⚠️ That instruction file is the real thing an agent boots from, not a copy, so
editing it here changes how that agent behaves the next time it starts. The
version it replaces is kept beside it as `CLAUDE.md.previous`.

⚠️ It answers only on **loopback**, and now checks the `Host` header as well as
the address, so a page on another site cannot reach it by pointing its own DNS
at your machine. That refuses a reverse proxy too, which is deliberate: there is
no authentication here. If you genuinely want one, name it in
`AGENT_WORKFORCE_ALLOWED_HOSTS` and understand that anyone who reaches that URL
can rewrite the file any of your agents boots from.

    node server.js      # then open http://127.0.0.1:4317

If Claude or tmux is not where this expects (an Intel Mac keeps Homebrew at
`/usr/local`; an npm-global Claude is not in `~/.local/bin`), creation refuses
and says so. Name them instead of editing the code:

    AGENT_WORKFORCE_CLAUDE_BIN=/usr/local/bin/claude \
    AGENT_WORKFORCE_TMUX_BIN=/usr/local/bin/tmux node server.js

## The rule this codebase is built around

An agent we cannot read is shown as **unknown**, never as something healthy.
Most monitoring bugs are the same shape: the check cannot tell "fine" from
"I can't see it", and shows green. Every value carries how it was determined,
and a value we cannot stand behind is left out rather than guessed.

## A note on live data

The status engine reads a real fleet doing real work. Pane titles and
transcripts can contain client names, financial work and private
correspondence.

- Fixtures are synthetic or redacted. Never a captured slice of live state.
- Anything captured from a real machine stays out of this repo.
- Screenshots of live data do not belong here either. Agent names plus task
  lines are already a disclosure.

This repo is private now and public later, so treat every commit as public.
