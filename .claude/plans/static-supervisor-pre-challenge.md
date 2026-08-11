---
pre_challenge: true
method: challenge-loop
branch: static-supervisor
diff_hash: 8698d8f5ef797ac4e9b441f0aed83649626ec75000a9d22f95f16584f008d9f6
subdir_audit: n/a
timestamp: 2026-08-11T05:31:48Z
iterations: 2
converged: false
---

## [CHALLENGE-LOOP] Summary

**Iterations:** 2
**Converged:** No. Stopped after round 2, which found no BLOCKERs. This is a
small, contained follow-up to `create-an-agent` (which took 11 rounds), and the
operator asked for it as a small PR overnight. The outstanding items are listed
rather than closed.
⚠️ **Recomputed after rebasing onto `main`.** The branch was stacked on
`create-an-agent`, which merged as a squash, so replaying these commits onto the
new `main` changed the diff this hash certifies. Checked rather than assumed —
the same stale-hash trap as the sibling branch.

**Total findings:** 20 actionable (3 BLOCKERs, 11 WARNINGs, 3 CONVENTIONs, 3 NITs)
**Fixed:** 20 | **Deferred:** 0

### Iteration 1
**New findings:** 3 BLOCKERs, 5 WARNINGs, 2 CONVENTIONs, 3 NITs

- **[BLOCKER] `engine/create.test.js` did not sandbox `AGENT_WORKFORCE_DATA`.**
  The suite sandboxes the workers and LaunchAgents roots; the SUPPORT root, where
  the shared supervisor is installed, was missed. So every non-dry-run test
  installed into the operator's real `~/Library/Application Support/
  AgentWorkforce` — **and the refresh test deliberately overwrote the live
  supervisor with a one-line comment** before putting it back. Measured: a test
  run moved that file's mtime on this machine. --> FIXED
- **[BLOCKER] The same test could leave the machine holding a supervisor that is
  a comment.** An interrupted run between the clobber and the reinstall leaves
  every created agent's job pointing at it: `bash` exits at once, `KeepAlive`
  respawns every thirty seconds forever. **Word for word the harm this branch
  exists to prevent, manufactured by its own test**, and durable — nothing
  cleaned that path up, because it was outside the sandbox. --> FIXED (sandboxed;
  the residue removed from the real directory; no agent had ever used it)
- **[BLOCKER] The module's safety header still described generated shell text and
  named `launcherFor`**, which this branch deletes. A reader auditing the
  injection surface was sent to a function that does not exist and told a
  property that is now inverted. --> FIXED
- [WARNING] `copyFileSync` rewrites the destination in place, same inode, while
  every live agent's supervisor is a `bash` process reading that file by offset —
  and this branch makes refresh-while-running the normal case --> FIXED
  (write-beside-and-rename)
- [WARNING] **The plist's argument order and the script's `$1..$5` are one
  contract with two ends, and nothing pinned it.** Swap two and every real agent
  starts with its working directory as its session name, with the suite green
  --> FIXED (the harness derives its argv from the plist the product writes;
  mutation-verified)
- [WARNING] Two install assertions were satisfied by a previous run's leftovers
  --> FIXED (as a side effect of sandboxing)
- [WARNING] A missing `bin/agent-supervisor.sh` was reported as "you can try that
  name again", which can never work --> FIXED
- [WARNING] The shape check's stated justification (interpolation into shell
  text) no longer applies --> FIXED
- [CONVENTION] README overstated "a fix reaches every agent" --> FIXED
- [CONVENTION] An agent created by the OLD code keeps its own copy; nothing
  migrates it --> FIXED (said in the README)

### Iteration 2
**New findings:** 0 BLOCKERs, 6 WARNINGs, 2 CONVENTIONs, 2 NITs

- [WARNING] **The supervisor travels to existing agents; its argument contract
  does not.** Each plist is written once and never rewritten, so a later
  supervisor that adds a required `$6` silently bricks every pre-existing agent
  --> FIXED (the constraint is stated where the next person to add an argument
  will read it: new arguments must be optional with defaults, or it is a
  migration rather than an edit)
- [WARNING] The "trying again will not help" sentence asserted a permanent cause
  for a failure whose cause had been thrown away — false for a full disk, and it
  is the sentence that stops the operator retrying --> FIXED (a missing source is
  distinguished from everything else)
- [WARNING] That sentence was itself unpinned --> FIXED
- [WARNING] The log-truncation branch is destructive and nothing exercised it;
  `wc` on an unreadable file makes `[ "" -gt N ]` a bash error, written into the
  very log it manages --> FIXED (guarded, and behaviourally tested both ways)
- [WARNING] A fixed staging filename lets two installs interleave into one inode;
  a failed chmod/rename left it behind --> FIXED (per-process name, cleaned up)
- [CONVENTION] Two more stale comments citing `start.sh` and generated shell text
  --> FIXED
- [NIT] The behavioural harness depended on an earlier test having installed the
  supervisor --> FIXED (installs its own)
- [NIT] `set-option` cannot take the exact-match form, and one narrow race
  survives the argument for why that is safe --> FIXED (named in the file)

### Verification that is not a test

- An agent created **through the route** with this code: claim set, board reads
  its name, role and state, no per-agent copy of the supervisor in its folder,
  no staging files left in the support directory.
- `launchctl kickstart -k` **adopted** the running session rather than replacing
  it, with the reason in its log.
- The shipped script driven directly against a scripted fake tmux across a
  stranger's session, a healthy adopt, a crashed `-zsh`, a split window, an
  unreadable `list-panes`, four non-Claude leftovers, and two version strings a
  glob would have accepted.
- Argument handling probed directly: no arguments, one argument, and an empty
  session each fail closed with a named message and a non-zero exit.
- Every artifact removed afterwards; the machine checked back to its prior state.

### Known limits

- **Old agents are not migrated.** None exist (the base branch is unmerged), which
  is exactly why this is cheap now and expensive later. Said in the README.
- **The refresh only fires when an agent is created.** On a machine where nobody
  creates another agent, a fix never arrives.
- **An older checkout downgrades the shared supervisor** on its next creation.
  There is no version stamp; adding one is worth doing when there is more than
  one version in the world.
