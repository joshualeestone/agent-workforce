#!/bin/bash
# The permission-acceptance merge in install/setup.sh (#46), exercised
# against the five states that matter. The snippet is EXTRACTED FROM the
# installer rather than copied here, so this test cannot drift green while
# the shipped code changes (a check containing a copy cannot fail).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

TMP="$(mktemp -d "${TMPDIR:-/tmp}/perm-accept.XXXXXXXXXX")"
trap 'rm -rf "$TMP"' EXIT

# Extract the embedded python between the heredoc markers.
sed -n '/PYEOF. 2/,/^PYEOF$/p' install/setup.sh | sed '1d;$d' > "$TMP/merge.py"
[ -s "$TMP/merge.py" ] || { echo "FAIL: could not extract the merge snippet"; exit 1; }

fail() { echo "FAIL: $1"; exit 1; }

# 1. No file, missing parent dirs: created with exactly the key.
python3 "$TMP/merge.py" "$TMP/a/b/s1.json" || fail "fresh create exited nonzero"
python3 - "$TMP/a/b/s1.json" <<'PY' || exit 1
import json, sys
d = json.load(open(sys.argv[1]))
assert d == {"skipDangerousModePermissionPrompt": True}, d
PY

# 2. Existing settings: merged, other keys preserved.
printf '{"theme":"dark","defaultMode":"bypassPermissions"}' > "$TMP/s2.json"
python3 "$TMP/merge.py" "$TMP/s2.json" || fail "merge exited nonzero"
python3 - "$TMP/s2.json" <<'PY' || exit 1
import json, sys
d = json.load(open(sys.argv[1]))
assert d["theme"] == "dark" and d["defaultMode"] == "bypassPermissions"
assert d["skipDangerousModePermissionPrompt"] is True
PY

# 3. Unparseable file: left byte-identical, nonzero exit.
printf 'not json{' > "$TMP/s3.json"
if python3 "$TMP/merge.py" "$TMP/s3.json" 2>/dev/null; then fail "unparseable did not refuse"; fi
[ "$(cat "$TMP/s3.json")" = "not json{" ] || fail "unparseable file was touched"

# 4. Already accepted: untouched (byte compare).
printf '{"skipDangerousModePermissionPrompt": true, "x": 1}' > "$TMP/s4.json"
cp "$TMP/s4.json" "$TMP/s4.before"
python3 "$TMP/merge.py" "$TMP/s4.json" || fail "already-true exited nonzero"
cmp -s "$TMP/s4.json" "$TMP/s4.before" || fail "already-true rewrote the file"

# 5. JSON but not an object: left alone, nonzero.
printf '[1,2]' > "$TMP/s5.json"
if python3 "$TMP/merge.py" "$TMP/s5.json" 2>/dev/null; then fail "non-object did not refuse"; fi
[ "$(cat "$TMP/s5.json")" = "[1,2]" ] || fail "non-object file was touched"

# 6. A tightened file keeps its mode through the merge.
printf '{"theme":"dark"}' > "$TMP/s6.json"
chmod 600 "$TMP/s6.json"
python3 "$TMP/merge.py" "$TMP/s6.json" || fail "tightened-file merge exited nonzero"
_mode="$(stat -f '%Lp' "$TMP/s6.json" 2>/dev/null || stat -c '%a' "$TMP/s6.json")"
[ "$_mode" = "600" ] || fail "merge widened a tightened file to $_mode"

echo "permission acceptance: six states hold (create, merge, refuse-unparseable, no-op, refuse-non-object, mode-preserved)"
