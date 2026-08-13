#!/bin/bash
# Build tmux and its three dylibs FROM SOURCE against the macOS deployment
# floor, so the bundle we ship can actually load on the Macs we promise.
#
# ⚠️ WHY THIS EXISTS. A binary copied off a build machine inherits that
# machine's OS as its minimum: the Homebrew tmux on this Mac stamps
# minos 26.0 (measured with otool), and dyld refuses to load a dylib built
# for a newer OS than the host -- so a bundle made from it works on the
# build machine and on NOTHING in the supported range. The floor gate in
# tools/lib/floor-gate.sh refuses to pack such a bundle for release; this
# script is what produces one it will accept. MACOSX_DEPLOYMENT_TARGET at
# compile time is what stamps the floor into every artifact.
#
# ⚠️ THE FLOOR COMES FROM tools/macos-floor, the same single source the
# gates read, so this builder cannot drift from what the installer promises.
#
# ⚠️ SOURCES ARE PINNED BY VERSION AND CHECKSUM. The four tarballs come
# from the projects' own release URLs, and each download is verified
# against the SHA-256 recorded below before anything is compiled. To bump
# a version: change the version, run with KOSMOS_TRUST_FIRST_FETCH=1 once
# (it prints the measured hash and refuses to finish), record the printed
# hash here, run clean. A release build never runs on trust.
#
# Output: a self-contained prefix at <out>/tmux-floor-prefix whose
# bin/tmux links the three freshly built dylibs. Feed it to the bundler:
#
#   TMUX_SOURCE=<out>/tmux-floor-prefix/bin/tmux tools/build-tmux-bundle.sh <out>
#
# The bundler's collect() picks up the prefix dylibs, rewrites their load
# paths, re-signs, and the floor gate certifies the result -- with no
# KOSMOS_ALLOW_MINOS override, which is the whole point.

set -euo pipefail

TMUX_VERSION="3.5a"
LIBEVENT_VERSION="2.1.12-stable"
NCURSES_VERSION="6.5"
UTF8PROC_VERSION="2.9.0"

# sha256 of each release tarball. Empty means not yet recorded: the script
# refuses to build it without KOSMOS_TRUST_FIRST_FETCH=1, and even then it
# stops after printing the measured hashes so they can be recorded here.
TMUX_SHA="16216bd0877170dfcc64157085ba9013610b12b082548c7c9542cc0103198951"
LIBEVENT_SHA="92e6de1be9ec176428fd2367677e61ceffc2ee1cb119035037a27d346b0403bb"
NCURSES_SHA="136d91bc269a9a5785e5f9e980bc76ab57428f604ce3e5a5a90cebc767971cc6"
UTF8PROC_SHA="bd215d04313b5bc42c1abedbcb0a6574667e31acee1085543a232204e36384c4"

TMUX_URL="https://github.com/tmux/tmux/releases/download/${TMUX_VERSION}/tmux-${TMUX_VERSION}.tar.gz"
LIBEVENT_URL="https://github.com/libevent/libevent/releases/download/release-${LIBEVENT_VERSION}/libevent-${LIBEVENT_VERSION}.tar.gz"
NCURSES_URL="https://invisible-island.net/archives/ncurses/ncurses-${NCURSES_VERSION}.tar.gz"
UTF8PROC_URL="https://github.com/JuliaStrings/utf8proc/releases/download/v${UTF8PROC_VERSION}/utf8proc-${UTF8PROC_VERSION}.tar.gz"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FLOOR="$(cat "$HERE/macos-floor")"
export MACOSX_DEPLOYMENT_TARGET="$FLOOR"

OUT="${1:-dist}"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
PREFIX="$OUT/tmux-floor-prefix"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

echo "==> building for macOS $FLOOR (MACOSX_DEPLOYMENT_TARGET)"

TRUST_LINES=""
fetch() {
  # Two statements, not one: bash does not make $name visible to later
  # assignments in the SAME local statement under set -u (the exact trap
  # install/setup.sh's make_app comment records, walked into again here).
  local name="$1" url="$2" want="$3" got
  local file="$WORK/$name.tar.gz"
  echo "==> fetching $name from $url"
  curl -fL --progress-bar "$url" -o "$file"
  got="$(shasum -a 256 "$file" | awk '{print $1}')"
  if [ -z "$want" ]; then
    if [ -n "${KOSMOS_TRUST_FIRST_FETCH:-}" ]; then
      TRUST_LINES="$TRUST_LINES
  $name: $got"
      return 0
    fi
    echo "FAIL: no recorded checksum for $name. Run once with KOSMOS_TRUST_FIRST_FETCH=1 to measure, then record the printed hash in this script." >&2
    exit 1
  fi
  if [ "$want" != "$got" ]; then
    echo "FAIL: checksum mismatch for $name" >&2
    echo "  want $want" >&2
    echo "  got  $got" >&2
    exit 1
  fi
  echo "    checksum ok"
}

fetch tmux     "$TMUX_URL"     "$TMUX_SHA"
fetch libevent "$LIBEVENT_URL" "$LIBEVENT_SHA"
fetch ncurses  "$NCURSES_URL"  "$NCURSES_SHA"
fetch utf8proc "$UTF8PROC_URL" "$UTF8PROC_SHA"

if [ -n "${KOSMOS_TRUST_FIRST_FETCH:-}" ]; then
  echo ""
  echo "Measured hashes -- record these in $(basename "$0") and re-run clean:"
  echo "$TRUST_LINES"
  echo ""
  echo "Refusing to build from unverified sources. (That is the point of the flag.)"
  exit 1
fi

rm -rf "$PREFIX"
mkdir -p "$PREFIX"
NCPU="$(sysctl -n hw.ncpu 2>/dev/null || echo 4)"

unpack() { tar -xzf "$WORK/$1.tar.gz" -C "$WORK"; }

echo "==> libevent $LIBEVENT_VERSION (core only)"
# ⚠️ CORE ONLY, HAND-INSTALLED, and both halves are measured facts. The
# 2.1.12 tree's libevent_extra and libevent_pthreads fail to LINK under
# this toolchain (undefined _evutil_* for arm64), and tmux links exactly
# libevent_core -- so the failing libraries are ones we must not ship
# anyway. `make libevent_core.la` needs the generated config header first
# (a plain `make` orders that via BUILT_SOURCES; a targeted make does not).
# The dylib's install_name already points at $PREFIX/lib from libtool, so
# the hand-install is a copy, not a relink.
unpack libevent
( cd "$WORK/libevent-$LIBEVENT_VERSION" \
  && ./configure --prefix="$PREFIX" --disable-openssl --disable-static --quiet \
  && make include/event2/event-config.h --quiet \
  && make libevent_core.la --quiet \
  && mkdir -p "$PREFIX/lib/pkgconfig" "$PREFIX/include" \
  && cp -RP .libs/libevent_core*.dylib "$PREFIX/lib/" \
  && cp -R include/. "$PREFIX/include/" \
  && cp libevent_core.pc "$PREFIX/lib/pkgconfig/" ) > "$WORK/libevent.log" 2>&1 \
  || { echo "FAIL: libevent build. Log tail:"; tail -20 "$WORK/libevent.log"; exit 1; }

echo "==> ncurses $NCURSES_VERSION (wide, shared, system terminfo)"
# ⚠️ THE COMPILED-IN TERMINFO PATH IS THE SYSTEM ONE, ON PURPOSE. The
# Homebrew build's compiled-in Cellar path is exactly the trap the
# installer pins TERMINFO_DIRS against; building with the macOS path baked
# in removes the assumption instead of papering it (the pin stays as belt
# and braces). And only libs+headers are installed: `make install` also
# writes a terminfo DATABASE, which dies on APFS's case-insensitive
# directories (terminfo's 6d/ vs 4d/ entries collide -- measured), and we
# must not ship a database we tell the loader never to read.
unpack ncurses
( cd "$WORK/ncurses-$NCURSES_VERSION" \
  && ./configure --prefix="$PREFIX" --with-shared --without-normal --without-debug \
       --without-ada --without-cxx-binding --enable-widec --without-manpages \
       --without-progs --without-tests --without-tack \
       --with-default-terminfo-dir=/usr/share/terminfo \
       --with-terminfo-dirs=/usr/share/terminfo \
       --enable-pc-files --with-pkg-config-libdir="$PREFIX/lib/pkgconfig" \
  && make -j"$NCPU" --quiet \
  && make install.libs install.includes --quiet ) > "$WORK/ncurses.log" 2>&1 \
  || { echo "FAIL: ncurses build. Log tail:"; tail -20 "$WORK/ncurses.log"; exit 1; }

echo "==> utf8proc $UTF8PROC_VERSION"
unpack utf8proc
( cd "$WORK/utf8proc-$UTF8PROC_VERSION" \
  && make -j"$NCPU" prefix="$PREFIX" \
  && make prefix="$PREFIX" install ) > "$WORK/utf8proc.log" 2>&1 \
  || { echo "FAIL: utf8proc build. Log tail:"; tail -20 "$WORK/utf8proc.log"; exit 1; }

echo "==> tmux $TMUX_VERSION"
unpack tmux
# ⚠️ tmux MUST LINK THE ncursesw IT WAS COMPILED AGAINST. Without the
# pkg-config pin, configure compiled against our 6.5 widec headers and
# then linked /usr/lib/libncurses.5.4.dylib -- an ABI mismatch that
# happened to pass tmux -V (measured on the first run of this script).
# The verification below asserts the linkage, so this cannot regress
# silently.
( cd "$WORK/tmux-$TMUX_VERSION" \
  && PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" \
     CPPFLAGS="-I$PREFIX/include -I$PREFIX/include/ncursesw" \
     LDFLAGS="-L$PREFIX/lib" \
     LIBNCURSES_CFLAGS="-I$PREFIX/include/ncursesw" \
     LIBNCURSES_LIBS="-L$PREFIX/lib -lncursesw" \
     ./configure --prefix="$PREFIX" --enable-utf8proc --quiet \
  && make -j"$NCPU" --quiet \
  && make install --quiet ) > "$WORK/tmux.log" 2>&1 \
  || { echo "FAIL: tmux build. Log tail:"; tail -30 "$WORK/tmux.log"; exit 1; }

# ⚠️ VERIFY WHAT WAS JUST BUILT: it runs, and every artifact carries the
# floor -- the same otool read the gates use, so a toolchain that ignored
# the deployment target fails HERE, not on a customer's Mac.
"$PREFIX/bin/tmux" -V >/dev/null || { echo "FAIL: built tmux does not run" >&2; exit 1; }
echo "    $("$PREFIX/bin/tmux" -V) built"
# Compile-against and link-against must be the same ncurses.
if ! otool -L "$PREFIX/bin/tmux" | grep -q "$PREFIX/lib/libncursesw"; then
  echo "FAIL: tmux linked a different ncurses than it was compiled against:" >&2
  otool -L "$PREFIX/bin/tmux" | grep -i curses >&2
  exit 1
fi
for f in "$PREFIX/bin/tmux" "$PREFIX"/lib/libevent_core*.dylib "$PREFIX"/lib/libncursesw*.dylib "$PREFIX"/lib/libutf8proc*.dylib; do
  [ -f "$f" ] || continue
  case "$f" in *.dylib) file -b "$f" | grep -q dynamically || continue ;; esac
  minos="$(otool -l "$f" 2>/dev/null | awk '/LC_BUILD_VERSION/{v=1} v && /minos/{print $2; exit}')"
  [ -n "$minos" ] || minos="$(otool -l "$f" 2>/dev/null | awk '/LC_VERSION_MIN_MACOSX/{v=1} v && /version/{print $2; exit}')"
  echo "    $(basename "$f"): minos $minos"
  [ "$minos" = "$FLOOR" ] || { echo "FAIL: $(basename "$f") stamped $minos, wanted $FLOOR" >&2; exit 1; }
done

echo "==> ok: floor-targeted prefix at $PREFIX"
echo "    next: TMUX_SOURCE=$PREFIX/bin/tmux tools/build-tmux-bundle.sh $OUT"
