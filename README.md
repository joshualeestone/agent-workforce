# Agent Workforce (working name)

A small team of agents that runs on your own computer, under your own
Claude subscription.

## Status: Phase 1

It shows you what the agents on this machine are doing, and it can now change
some of what they are: their picture, what you call their job, and the
instruction file each one reads when it starts.

**It can also make one.** Pick what the agent is for, give it a name, and it
writes the folder and the instructions, installs a launchd job, loads it, and
then WATCHES THE BOARD until it can see the agent running before it says so.

Every agent's job runs the same supervisor, `bin/agent-supervisor.sh`, with its
own name as an argument. One file rather than a copy per agent, so a change to
it reaches agents that already exist: it is reinstalled whenever an agent is
created, and each running agent picks it up at its next start.

No terminal, and nothing claimed that was not observed: if the board cannot see
the agent after thirty seconds, the screen says that instead.

⚠️ Two conditions on "reaches agents that already exist", worth stating rather
than implying. On a machine where no further agent is ever created, nothing
reinstalls it. And an agent made by a version before this one has its own copy
of the old script and keeps it: nothing migrates those.

**It can also remove one**, from the bottom of that agent's own detail screen,
behind a confirmation that names the agent.

⚠️ **Remove is not delete, and only Remove exists.** Removing an agent takes it
off this board and stops it starting again. It does not delete anything: not the
agent's folder, not the instructions you wrote, not its startup file. That is
what "The agent's folder and the contents you wrote for it will not be deleted"
on the confirmation means, and it is meant literally.

**Removed agents can be put back.** They are listed under "Show removed agents"
at the bottom of the Agents tab, each with a Restore button that re-enables the
same startup job that was disabled.

It removes agents it did not create, too. Being able to manage the ones you
already have is the point — so a startup file another tool wrote is disabled
rather than deleted, and Restore turns exactly that one back on.

⚠️ **With one limit, and it is deliberate.** The board also draws a card for any
tmux session that merely happens to be running Claude — a `tmux new -s notes`
you opened yourself. Kosmos will not remove one of those: it cannot tell that
the session belongs to the agent whose name it is filed under, and stopping it
could stop the wrong thing. The screen says so where the Remove control would
otherwise be. Every agent Kosmos made, and every one another tool set up
properly, is removable; a card the board cannot vouch for is not.

**It can also connect Claude.** On first-run step 3, if no subscription is
connected, one click downloads Claude Code (checksum-verified before anything
is executed, with a real progress bar from real bytes), installs it with no
sudo and no Homebrew, and drives the sign-in: the browser opens, the person
signs in, and if Claude hands them a code there is a box here to paste it into.
The finish line is the settings file actually saying `connected` — never a
sentence scraped off a terminal. A screen the driver does not recognise is
reported as "we could not finish", with what the terminal actually said shown,
and the manual path (open Terminal, type `claude`) always offered.

⚠️ **What that flow has NOT proven yet:** the final hop — pasting a real code
and watching credentials land — has only run against a scripted fake, because
completing it for real means signing an agent's machine into a live account.
`docs/browser-checks/live-connect.js` proves everything up to the paste prompt
against the real CLI; the last step belongs to the first walkthrough on a
machine that is not this one.

While a sign-in is in flight there is a real tmux session called
`kosmos-connect` running Claude, so the Agents tab may briefly show it as a
card the board cannot vouch for. That is the board honestly reporting what is
running; the card leaves when the sign-in finishes. The name is reserved (you
cannot create an agent called `kosmos-connect`), and every command the flow
sends is pinned to the exact session name.

It cannot message an agent yet.

⚠️ **If you need to remove one by hand** — because it was made before this
existed, or because a removal reported that it could not finish — a created
agent has a launchd job that starts it at every login, and deleting its folder is
not enough:

    launchctl enable gui/$UID/com.kosmos.agent.<name>
    launchctl bootout gui/$UID/com.kosmos.agent.<name>
    rm ~/Library/LaunchAgents/com.kosmos.agent.<name>.plist
    tmux kill-session -t "=<name>"
    rm -rf ~/work/workers/<name>
    # and what this app remembered about it, which is kept elsewhere:
    rm -f ~/Library/Application\ Support/AgentWorkforce/avatars/<name>.*
    rm -f ~/Library/Application\ Support/AgentWorkforce/profiles/<name>.json
    rm -f ~/Library/Application\ Support/AgentWorkforce/commitments/<name>.json

⚠️ **The `enable` line first, and it is the one people will not think of.** A
removal that got as far as disabling the job and then could not finish leaves a
**disabled override in launchd's per-user database, keyed on the label** — and
nothing on disk records it, so deleting the plist and the folder does not clear
it. Create an agent under that name later and launchd refuses to start it, with
nothing in the product to explain why. `enable` is what removes the override;
it is harmless on a label that was never disabled, which is why it is listed
unconditionally rather than as a special case.

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

⚠️ It answers only on **loopback**, and checks the `Host` header as well as
the address, so a page on another site cannot reach it by pointing its own DNS
at your machine. The `Host` check refuses a reverse proxy too, which is
deliberate: there is no authentication here.

⚠️ **It also refuses a write that came from another page**, which is a
different hole and the more dangerous one, because it needs nothing to be
misconfigured. A POST with a form content type needs no CORS preflight, so
before that guard existed any site you visited could create an agent on your
machine. Measured against this server, not theorised.

If you genuinely want to reach this from somewhere else, name that host in
`AGENT_WORKFORCE_ALLOWED_HOSTS`, and understand that anyone who reaches that URL
can rewrite the file any of your agents boots from, and make new ones.

    node server.js      # then open http://127.0.0.1:4317

If Claude or tmux is not where this expects (an Intel Mac keeps Homebrew at
`/usr/local`; an npm-global Claude is not in `~/.local/bin`), creation refuses
and says so. Name them instead of editing the code:

    AGENT_WORKFORCE_CLAUDE_BIN=/usr/local/bin/claude \
    AGENT_WORKFORCE_TMUX_BIN=/usr/local/bin/tmux node server.js

## Projects

A project is **a folder you already have**, plus the agents you have put on it.
Nothing this app generates is ever written into that folder; everything it keeps
lives in its own store, so a project can be a repo somebody already has.

Two caveats belong here rather than in a comment, because both are things a
person could otherwise believe and have no way to check.

⚠️ **Putting an agent on a project is not a permission.** It is how you say
which agents belong to which work, and nothing more. Every agent on this machine
runs with `--dangerously-skip-permissions` and nothing is enforced anywhere, so
you will find no lock icon, no "access", and no wording suggesting an agent
cannot reach something. A boundary that is not enforced is worse than none,
because the person believing it has no way to find out.

⚠️ **A running agent does not see the change.** Putting an agent on a project
writes the project's folder into that agent's instruction file, and an agent
reads that file once, when it starts. So the screen says *"it will see that the
next time it starts"* rather than anything in the present tense. Where the file
could not be written at all — an agent with no folder on this machine, or one
whose instructions live somewhere this app will not touch — the membership is
still recorded and the row says we could not tell it, and why.

What removal does, in both directions: removing an agent from a project, or
removing the project itself, takes our record away and **tries** to take the
block back out of the affected agents' instruction files. ⚠️ **That second half
can fail, for every reason the first write can** — the agent has stopped, has no
folder on this machine, or keeps its instructions somewhere this app will not
touch. When it does, the record is still gone and the screen says which agents
still mention the project and why, because a block left in a file naming a
project that no longer exists is something only you can clear. **Nothing in the
folder is ever deleted**, and a project can be added again — though the name you
gave it and the agents you put on it are not kept.

## The rule this codebase is built around

An agent we cannot read is shown as **unknown**, never as something healthy.
Most monitoring bugs are the same shape: the check cannot tell "fine" from
"I can't see it", and shows green. Every value carries how it was determined,
and a value we cannot stand behind is left out rather than guessed.

⚠️ One deliberate narrowing, named here rather than left for you to find: an
agent sitting at its own prompt is reported **idle** rather than unknown, on the
evidence that Claude's own input box is on screen. That makes `unknown`
effectively unreachable for a pane where Claude is running. It was worth it
because an agent left waiting for you otherwise decayed into "we cannot see this
one" as soon as its last output scrolled away, on the very card you had just
created. The residual risk is a Claude whose interface has hung: it still draws
that box. See `classify` in `engine/status.js`.

## A note on live data

The status engine reads a real fleet doing real work. Pane titles and
transcripts can contain client names, financial work and private
correspondence.

- Fixtures are synthetic or redacted. Never a captured slice of live state.
- Anything captured from a real machine stays out of this repo.
- Screenshots are held to the same rule, and the rule is about **where the text
  came from**, not about which words it contains. A shot of the running board
  ships whatever the fleet happened to be doing that minute, and those task
  lines have carried client names and financial work.
- So: a board fed by a **fake tmux with invented task lines** is fine, and the
  names on the cards are not the sensitive part -- a name grants nobody
  anything. `docs/screenshots/remove-*.png` are exactly that. Clarified
  2026-08-11 because the earlier wording ("agent names plus task lines are
  already a disclosure") read as a ban on the names, and a rule stricter than
  its reason gets worked around rather than followed.

This repo is private now and public later, so treat every commit as public.
