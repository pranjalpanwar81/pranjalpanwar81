#!/usr/bin/env bash
# Removes the star and fork counters that github-profile-3d-contrib draws
# under the skyline (an icon group followed by its number), keeping the
# contributions total.
set -euo pipefail
for f in profile-3d-contrib/*.svg; do
  perl -0pi -e 's#<g transform="translate\(\d+, \d+\), scale\(2\)"><path [^>]*></path></g><text [^>]*>\d+<title>\d+</title></text>##g' "$f"
done
