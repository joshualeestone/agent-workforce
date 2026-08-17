# Re-testing the install like a new user

The instruction this page replaces has now been given wrong twice by
people who had read the code that explains why. Read this instead of
remembering.

## The trap

`--uninstall` deliberately preserves the AgentWorkforce store
(install/setup.sh: "the STORE next to it is the user's agent records
and stays" -- uninstalling the app must never delete somebody's work).
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
only want to see the first-run screens.

## Why not make --uninstall take the store too

Because an installer that cleans up too enthusiastically is worse than
one that leaves a folder behind (setup.sh's own words). The store is
the person's work; a test procedure is not a reason to change what the
supported path protects.
