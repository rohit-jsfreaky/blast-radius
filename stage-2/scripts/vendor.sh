#!/bin/sh
# Copies the fonts and icons the UI uses out of the npm packages in $1 (a node_modules parent) into $2.
# Run by the Dockerfile at build time; nothing is fetched at run time.
set -e
SRC="$1/node_modules"
OUT="$2"
mkdir -p "$OUT/fonts" "$OUT/icons"
for f in latin latin-ext; do
  cp "$SRC/@fontsource-variable/shantell-sans/files/shantell-sans-$f-wght-normal.woff2" "$OUT/fonts/"
  cp "$SRC/@fontsource-variable/hanken-grotesk/files/hanken-grotesk-$f-wght-normal.woff2" "$OUT/fonts/"
done
for i in armchair arrow-right arrows-clockwise calendar-blank check check-circle circle-notch clock-clockwise copy \
         hourglass info magnifying-glass plus prohibit seal-check sign-out storefront user user-circle users warning x-circle; do
  cp "$SRC/@phosphor-icons/core/assets/regular/$i.svg" "$OUT/icons/"
done
