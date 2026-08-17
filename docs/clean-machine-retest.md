# Re-testing the install like a new user

The instruction this page replaces has now been given wrong twice by
people who had read the code that explains why. Read this instead of
remembering.

## The trap

`--uninstall` deliberately preserves the AgentWorkforce store, except
the app's own `bin/` plumbing inside it (install/setup.sh: "the STORE
next to it is the user's agent records and stays" -- uninstalling the
app must never delete somebody's work).
The first-run flag, `first-run.json`, lives INSIDE that store
(engine/firstrun.js). So on any machine where the wizard was ever
completed, uninstall-then-reinstall boots straight to the board with
no wizard, which looks exactly like the release shipping broken.

## Full clean-machine test (destructive)

Removes the app AND the person's data: About-you answers, agent
records, and the projects folder. Only on a machine whose data you
mean to lose.

```
curl -fsSL https://installkosmos.com/setup | sh -s -- --uninstall
rm -rf ~/Library/Application\ Support/AgentWorkforce ~/Kosmos/Projects
curl -fsSL https://installkosmos.com/setup | sh
```

## Re-arm the wizard only (keeps everything)

One file: the flag. Agents, records, and projects survive.

```
rm ~/Library/Application\ Support/AgentWorkforce/first-run.json
```

Relaunch Kosmos and the wizard runs again. No uninstall needed if you
only want to test the real boot decision.

## Just LOOKING at the screens (no state touched)

`/?first-run=1` (plus `&fr-step=N` for a specific step) forces the
wizard open with zero state mutation -- built for screenshots. Use the
rm form above when you are testing the boot decision itself; use the
deep link when you only need to see a screen.

## What neither form can show you

The wizard's last screen forks on what is RUNNING: live tmux agents
route you down the adopt path ("You already have N agents here"), and
only a machine with none shows the new user's create path. Both forms
above leave running agents alone (so does --uninstall, deliberately),
so on a machine with a live fleet you will never see the create branch
this way. A genuinely new user's full path needs a machine with no
agents running.

## Why not make --uninstall take the store too

Because an installer that cleans up too enthusiastically is worse than
one that leaves a folder behind (setup.sh's own words). The store is
the person's work; a test procedure is not a reason to change what the
supported path protects.
