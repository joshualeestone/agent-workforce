# Plan: reject-mangled-panes

**Branch:** `reject-mangled-panes`
**Base:** `main` (independent of the two open PRs)
**Closes:** #23
**Reviewer:** `joshualeestone`
**Author:** Angel
**Date:** 2026-08-11

## Why

Filed as #23 this morning, after the board ran under launchd for ~14 hours
reporting **zero agents**, then briefly reported **thirteen agents named
`angel-discord_0.0_2.1.223_0__ …`**. Both were environment problems in the
plist (missing `PATH`, then missing `LANG`), fixed at the time. Each surfaced
the same weakness in `parsePanes`, which is still live on `main`: measured
again tonight on both `main` and the create-an-agent branch.

`PANE_FORMAT` is tab-separated. Without a UTF-8 locale, **tmux sanitises its own
format output** and replaces the tabs. `parsePanes` then puts the whole line in
the first column and defaults the rest, emitting a syntactically valid agent
whose name is the entire line.

## ⚠️ The half the issue did not ask for, which is the half that cost the hours

Rejecting those lines is what #23 proposes, and on its own it recreates the
worse failure: every line rejected becomes an EMPTY roster, and an empty board
is indistinguishable from a machine with no agents. **That is precisely what was
on screen for fourteen hours while thirteen agents were running.**

So this change does both:

- [x] A line with no separator is not a pane.
- [x] "We understood none of it" refuses, in `listPanes` (the board) and in
      `paneRoster` (the gate), rather than answering "nothing".
- [x] A partly-unreadable answer keeps the agents it could read AND carries the
      count, which the summary line shows, so the board never presents what it
      managed to parse as the whole machine.

## ⚠️ What is deliberately NOT rejected

A TRUNCATED line. It still names a session we can identify, and its missing
fields default to the unsafe answer (`inMode` defaults to in-copy-mode, a
missing `command` classifies `unknown` rather than `stopped`) — behaviour this
module already has tests for. Dropping those would hide a running agent, which
is the same harm as showing a garbage one, pointed the other way.

The rule is therefore "is the session a field", not "are all the fields there".

## Definition of done

1. The exact string the board showed produces no agent.
2. A wholly unreadable answer refuses, on both the board and the gate.
3. A partly unreadable one shows what it has and says what it lost, on screen.
4. A truncated line is still an agent.
5. `node --test` green, and every guard mutation-tested.
