# tell-operator: the failed-send instruction names its audience

Date: 2026-08-18 ~9:17 PM. Branch `tell-operator`. Mona Lisa's review of
engine/messages.js:748 (message 1539458072232075305), sequenced ahead of
the members quieting on Splinter's grounds: it restores a verification
path (his check 3 could not fail informatively while the instruction was
satisfiable by an agent narrating to itself).

- Her copy verbatim: "tell your operator" names the audience (the whole
  point), and "leaves no trace for anyone to find" drops the UI-internal
  metaphor for a reader that has never seen our UI.
- Existing agents pick it up automatically: the colleagues block heals
  on drift (#83's machinery, its second use tonight).

## Tests

- The existing failure-line pin in projects.test.js asserts
  'say what happened in' -- updated to pin the audience phrase instead
  ('tell your operator'), which is the load-bearing part.
