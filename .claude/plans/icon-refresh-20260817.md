# icon-refresh: touch the bundle before registering it

Josh's clean-machine install on the brand-new mini (2026-08-17, the
once-only test): Kosmos.app present, Get Info previews the icon, the
Dock draws the generic tile. The shipped icns is provably complete
(unpacked from the 0.1.3 bundle: all ten representations through
1024), CFBundleIconFile matches the filename, and the lsregister step
runs, so what remains is macOS not re-reading artwork it first saw
absent: the icns is the LAST file staged into the bundle, and Finder
and the Dock key their re-read off the bundle directory's mtime.

One-line fix in the installer's register step: `touch -c "$app"`
before `lsregister -f`, inside the same never-from-a-sandbox guard.
Failure stays non-fatal (`|| true`), matching the step's posture. The
comment separates what was MEASURED (the symptom triple) from the
HYPOTHESIS (mtime-keyed icon re-read; the mv preserves the stage's
mtime) and says plainly that the fix is the non-invasive subset of the
manual remedy and remains unverified until the next clean-machine
install -- a still-generic tile there does NOT rule this area out.

Josh's current machine was handed the manual equivalent in channel
(touch + lsregister -f + killall Dock); this fixes the NEXT install.
Ships to installkosmos.com/setup with the next /setup republish (the
0.1.4 release), per the site's merge-then-deploy rule.

## Verification

sh -n clean; tools/check-floor-consistency.sh green; the change sits
entirely inside the existing sandbox guard so no harness run can touch
the real LaunchServices database (the guard's own rule).
