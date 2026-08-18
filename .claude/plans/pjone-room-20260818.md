# pjone-room: the project room's screen (View D, chunk 2 of 2)

Built against CURRENT-FREEZE (FROZEN-2026-08-18, sha 490b9d00...) for
the pjone SHELL (pjhead, the pj3 three-column layout, thread/msg
styling) and against the View D spec for the room semantics. The pack's
own conversation fixtures (filedrop, code blocks, link previews) are
its demo drawing, explicitly awaiting this build to settle: the freeze
says the build leads the pack on this screen. What ships here is the
room: members, thread, composer, receipt.

Decisions:

- OPERATOR POSTS land in the engine as sendPost({ operator: true }):
  no pane, from 'you' with an explicit operator: true flag on the row
  (a name alone cannot be trusted as the distinction, because 'you' is
  a legal tmux session name). Per the recorded valve decision, operator
  posts neither count toward ROOM_CAP nor meet its refusal.
- Operator arrivals carry their OWN markers, distinct from the
  colleague pair: '[message from your operator · id · project p]' for
  @-mentioned members, '[from your operator in project p · id · for
  the whole room]' for the rest. The forgery gate refuses all four
  marker spellings in bodies on both send paths: an agent must not be
  able to smuggle operator authority into a room.
- The thread is record() filtered by project alone (the spec's
  falsifiable claim), posts and the room valve row, oldest first,
  operator rows keyed on the flag; @ stays visible in the text.
- The receipt sentence builds from outcomes per recipient with honest
  grammar for the states the engine actually returns: "Placed with A
  and B. C may have it; not confirmed, so it is not re-sent. D could
  not be reached." (The pack's "waits until this turn ends" implies a
  queue that does not exist; the sentence stays inside the truth.)
- Ripple 5: a post on an agent's page renders AS a room post naming
  its project, never as a direct message.
- The existing fleet learns the room at its natural teaching moment:
  the told-message an agent receives when added to a project now names
  `kosmos post <id>` (engine/projects.js copy).
- Remaining after this chunk, recorded not dropped: the clean-chat
  "Send 1 to accept, or 2 to decline" sentence beside the verbatim
  pane quote (agent-page rendering), and Engineering-mode wiring (#60).

Mid-build ruling folded in (Mona Lisa, 12:21 PM): the room valve's unit
is ARRIVALS, not posts. The valve exists for cost, and one post into a
five-member room is four agent turns; a post-count cap chosen to look
"the same order" as the pair cap would be eight times the spend, and
counted in arrivals a bigger room tightens automatically.
ROOM_ARRIVALS_CAP = 40 per half hour (Angel's value: a five-member room
gets ten posts, the pair's own post count; a cap that breaks a
productive conversation is worse than one that runs long). This post's
own arrivals are charged up front. Operator posts still count nothing
and are never refused. The person-facing sentence is unchanged, as she
ruled: it explains nothing arithmetical on purpose.

The screen, as built: pjone rides the ground (the panel behind the
columns retired; the pack's pjcols are the cards), pjhead pairs title
and description with the settings door in the corner, the pj3 grid
holds members / conversation / tasks, and the room thread + composer
sit above the per-agent block, whose battle-tested ids all survive.
The room paints from /api/project/:id/room (record by project alone);
posts park drafts as typed; the poll repaints with the same
generation-counter discipline as the thread. The drive gains 3b-room
(seeded shaped rows, never route posts: the sandbox roster is the real
board and a route post would fan into live panes): attribution, the
You-chip never from the face set, the per-recipient receipt with the
failed weight, escaping, and the valve as reassurance.

The blind pass (one blocker, all findings landed):
- the room composer inherited NONE of the sibling's flight-race
  discipline and a fan-out flight is seconds long: typed-on-top words
  were deleted, a mid-flight project switch wiped the wrong project's
  draft and left the takeoff draft armed for a double post. Rewritten
  with the sibling's shape whole: takeoff capture, exact-match clear,
  exact-match parked-draft retire, verdicts landing only on the takeoff
  project, plus the room's own repeat-still-announces live region for
  every verdict (success, refusal, and network failure alike).
- an unknown outcome state lands in the not-confirmed clause, matching
  the pill's unsure weight ("could not be reached" licenses a free
  re-send an unknown state does not).
- unreadable-and-empty renders the note alone (never "Nothing here
  yet"), and the thread scrolls only when the POSTS change, keyed on
  ids, so the minute-relabel poll cannot yank a reader out of history.
- the charged-up-front arithmetic has its distinguishing-band test (39
  seeded arrivals: a two-arrival post refuses, a one-arrival post
  lands).
- the stale operator-exemption comment, the forgery sentence misnaming
  operator markers, and the drive's missing presence control on the
  You-chip check all fixed; the room tokens' absence from the AA sweep
  is a recorded acceptance (same measured token pair as the cards).

Pass 2 (blind, blocker-free: converged with pass 1's fixes):
- the two room routes gained route-level tests (the operator flag is
  minted only there and a body claiming operator changes nothing; the
  thread filters by project alone with a foreign-project control).
- the scroll key resets with the switching clear (A-B-A no longer lands
  a reader on the oldest post), the empty-composer refusal announces,
  the partial-delivery headline says "Posted, not to everyone" instead
  of a bare Posted, the memberless empty-room hint stops promising a
  delivery the engine would refuse.
- an agent named like a project no longer inherits that room's
  bookkeeping rows: project-typed `to` values (room valves, room
  refusals) are never matched against agent names on either read side.
- the stranded tasks comment moved with its field; the dead attribute
  dropped.

Queued next (Josh's ruling, 12:52 PM, with Mona Lisa's design): the
valve caps become a Settings control, in the PERSON'S unit (exchanges;
the engine converts to arrivals), her control copy and honest off-state
sentence verbatim. Whether a floor above zero exists is JOSH'S open
call, flagged to him in-channel (12:53 PM): with a floor, a runaway
always terminates on our terms; without one, it terminates on his
subscription's terms, which is a limit he chose. Defaults as shipped
either way. Also hers for the record: the pair cap's 10 is an inherited
convergence number doing a cost job; the room cap is derived. If a real
conversation gets cut short, the inherited number was wrong.
