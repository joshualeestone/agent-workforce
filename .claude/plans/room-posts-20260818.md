# room-posts: the project room's engine (View D, chunk 1 of 2)

Built against Mona Lisa's final View D spec
(Josh-Brain/Projects/kosmos-view-d-project-room-2026-08-18.md), which
supersedes the record-only model per Josh's ruling ("agents have to be
able to speak to each other in a project window just like we do here").
This chunk is the ENGINE: the post kind, room fan-out with marked
background delivery, the group valve, and the five ripples. The pjone
screen (three columns, thread, composer, receipt sentence, operator
posting) is chunk 2.

Decisions:

- sendPost({ fromPane, project, text }, roster, members): sender is
  pane-derived exactly like send() (the same guard chain, reused whole:
  envelope-name gate, body-as-itself, marker forgery, spill, document
  cap). Operator posting arrives with the screen chunk, which owns how
  an operator is named in the room; nothing here assumes only agents
  will ever post.
- ONE log row per post (the spec's schema verbatim): { kind: 'post',
  id, project, from, to: [names], text, at, outcomes: { name: state } }.
  Ids mint from the same m-counter as messages so a post is citable by
  in_reply_to with no second id space.
- Addressed vs background is parsed from @mentions against the member
  list, and BOTH arrive; the marking carries the safety property:
    addressed:  [message from your colleague <from> · <id> · project <p>]
    background: [background from your colleague <from> · <id> · project
                 <p> · not addressed to you]
  The forgery gate refuses bodies carrying either marker. The born
  block's overheard-message sentence (#73) is the posture this marking
  keys into.
- The GROUP VALVE composes with the pair valve: ROOM_CAP posts per
  project per window, counted across the whole thread regardless of
  sender (a room can loop without any two participants looping). Copy is
  Mona Lisa's verbatim ("...asked everyone to bring you in"). ROOM_CAP
  is 20 per 30 minutes: the pair cap is 10 for two participants, a room
  of several deserves the same order, not more; recorded as Angel's
  pick, flag to Mona Lisa with the screen chunk. The valve row logs
  kind 'valve' with to = the project id AND a project field: to as a
  string satisfies the record's shape rule, project is what marks it as
  the room valve.
- The five ripples, all from the spec:
  1. send()'s citation widens to posts, keeping the membership RULE and
     replacing the test: from === cited.from || (array to).includes.
  2. pairCount's kind filter gains the deliberateness comment (posts
     must not count toward a direct-message cap, and pairKey on an
     array would be silent garbage).
  3. The shape validator gains the post rule (array to, object
     outcomes).
  4. list(agent) matches to.includes(agent) for posts.
  5. Agent-page rendering naming the project is the screen chunk's.
- Partial delivery is held per recipient in outcomes and the row logs
  when at least one recipient was reached (typed-only, send()'s rule);
  a post reaching nobody refuses, cleans its spill, and logs nothing.
- Route POST /api/post and CLI `kosmos post <project> <text>` mirror
  the /api/msg + cmd_msg pattern (bash-3.2 JSON escaping and the
  three-state verdict included), so the falsifiable claims are checkable
  end to end from a pane.

Splinter's review-time catch (HEADS-UP, 11:34 AM), decided now rather
than inherited by the screen chunk: the room valve neither counts
operator posts nor refuses the operator. The valve's remedy is "bring
the person in", and a person driving the room is that remedy already in
progress; firing the everyone-sentence at them reads as broken. Vacuous
today (all posts are pane-derived agents), binding on the operator path
when the screen chunk builds it. Also acknowledged from the same note:
a fixed per-project cap means bigger rooms are tighter per head (five
members get four posts each where two get ten). Accepted for now as the
cost bound; flagged alongside the ROOM_CAP number for Mona Lisa.
