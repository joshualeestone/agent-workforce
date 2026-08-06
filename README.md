# Agent Workforce (working name)

A small team of assistants that runs on your own computer, under your own
Claude subscription.

## Status: Phase 1

Read-only. It shows you what the agents on this machine are doing. It cannot
start, stop, message or change any of them yet.

    node server.js      # then open http://127.0.0.1:4317

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
