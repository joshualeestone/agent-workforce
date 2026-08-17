#!/bin/bash
# The permission-acceptance merge in install/setup.sh (#46), exercised
# against the eight states that matter. The snippet is EXTRACTED FROM the
# installer rather than copied here, so this test cannot drift green while
# the shipped code changes (a check containing a copy cannot fail).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TMP="$(mktemp -d "${TMPDIR:-/tmp}/perm-accept.XXXXXXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Extract the embedded Node script between the heredoc markers. The
# installer runs it on the bundle's own runtime (no CLT shim on a clean
# Mac); the logic is identical under any node, so the test uses PATH's.
sed -n '/NODEEOF. 2/,/^NODEEOF$/p' install/setup.sh | sed '1d;$d' > "$TMP/merge.js"
[ -s "$TMP/merge.js" ] || { echo "FAIL: could not extract the merge snippet"; exit 1; }

fail() { echo "FAIL: $1"; exit 1; }

# 1. No file, missing parent dirs: created with exactly the key.
node "$TMP/merge.js" "$TMP/a/b/s1.json" || fail "fresh create exited nonzero"
python3 - "$TMP/a/b/s1.json" <<'PY' || exit 1
import json, sys
d = json.load(open(sys.argv[1]))
assert d == {"skipDangerousModePermissionPrompt": True}, d
PY

# 2. Existing settings: merged, other keys preserved.
printf '{"theme":"dark","defaultMode":"bypassPermissions"}' > "$TMP/s2.json"
node "$TMP/merge.js" "$TMP/s2.json" || fail "merge exited nonzero"
python3 - "$TMP/s2.json" <<'PY' || exit 1
import json, sys
d = json.load(open(sys.argv[1]))
assert d["theme"] == "dark" and d["defaultMode"] == "bypassPermissions"
assert d["skipDangerousModePermissionPrompt"] is True
PY

# 3. Unparseable file: left byte-identical, nonzero exit.
printf 'not json{' > "$TMP/s3.json"
if node "$TMP/merge.js" "$TMP/s3.json" 2>/dev/null; then fail "unparseable did not refuse"; fi
[ "$(cat "$TMP/s3.json")" = "not json{" ] || fail "unparseable file was touched"

# 4. Already accepted: untouched (byte compare).
printf '{"skipDangerousModePermissionPrompt": true, "x": 1}' > "$TMP/s4.json"
cp "$TMP/s4.json" "$TMP/s4.before"
node "$TMP/merge.js" "$TMP/s4.json" || fail "already-true exited nonzero"
cmp -s "$TMP/s4.json" "$TMP/s4.before" || fail "already-true rewrote the file"

# 5. JSON but not an object: left alone, nonzero.
printf '[1,2]' > "$TMP/s5.json"
if node "$TMP/merge.js" "$TMP/s5.json" 2>/dev/null; then fail "non-object did not refuse"; fi
[ "$(cat "$TMP/s5.json")" = "[1,2]" ] || fail "non-object file was touched"

# 6. A tightened file keeps its mode through the merge.
printf '{"theme":"dark"}' > "$TMP/s6.json"
chmod 600 "$TMP/s6.json"
node "$TMP/merge.js" "$TMP/s6.json" || fail "tightened-file merge exited nonzero"
_mode="$(stat -f '%Lp' "$TMP/s6.json" 2>/dev/null || stat -c '%a' "$TMP/s6.json")"
[ "$_mode" = "600" ] || fail "merge widened a tightened file to $_mode"

# 7. A zero-byte file is the absent case, not a refusal.
: > "$TMP/s7.json"
node "$TMP/merge.js" "$TMP/s7.json" || fail "zero-byte file was refused"
python3 - "$TMP/s7.json" <<'PY7' || exit 1
import json, sys
assert json.load(open(sys.argv[1])) == {"skipDangerousModePermissionPrompt": True}
PY7

# 8. A symlinked settings file keeps its link: the write goes THROUGH to
# the target, and the link still points where the person aimed it.
mkdir -p "$TMP/dotfiles"
printf '{"theme":"dark"}' > "$TMP/dotfiles/real-settings.json"
ln -s "$TMP/dotfiles/real-settings.json" "$TMP/s8.json"
node "$TMP/merge.js" "$TMP/s8.json" || fail "symlink merge exited nonzero"
[ -L "$TMP/s8.json" ] || fail "the merge severed the symlink"
python3 - "$TMP/dotfiles/real-settings.json" <<'PY8' || exit 1
import json, sys
d = json.load(open(sys.argv[1]))
assert d["theme"] == "dark" and d["skipDangerousModePermissionPrompt"] is True
PY8

echo "permission acceptance: eight states hold (create, merge, refuse-unparseable, no-op, refuse-non-object, mode-preserved, empty-is-absent, symlink-preserved)"
