# pipeline-guard — card #54's build half

tools/build-kosmos-bundle.sh now emits install/setup.sh beside the
tarball as dist/setup (+ .sha256). The incident this closes: 2026-08-17,
the reviewed-and-correct installer beside a site serving a 1569-line
stale copy for 51 minutes. With the installer riding dist/, the site
release step copies dist/* and cannot cut a release that leaves /setup
behind; the version number becomes the forcing function.

Proven by running the build: dist/setup emitted, byte-identical to
install/setup.sh (sha pair equal), sidecar verifies. Pairs with the
site's tools/live-sweep.sh (chaoskosmos-site#41), which catches the
served side and was proven to fail on a staled copy.

Deferred, recorded on the card: the icons same-master guard.
