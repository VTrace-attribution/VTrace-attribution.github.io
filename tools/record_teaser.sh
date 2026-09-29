#!/usr/bin/env bash
# Render the teaser animation (static/motion/record.html) frame by frame with headless Chrome and
# stitch it into static/motion/teaser.mp4 (+ teaser_poster.png). Needs google-chrome and ffmpeg.
#   bash tools/record_teaser.sh            # serves the folder on :8766 itself
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FPS=${FPS:-15}; DUR_MS=${DUR_MS:-7600}; PORT=${PORT:-8766}; JOBS=${JOBS:-4}
FRAMES="${TMPDIR:-/tmp}/vtrace_frames"; rm -rf "$FRAMES"; mkdir -p "$FRAMES"
cd "$ROOT"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!; trap 'kill $SRV 2>/dev/null || true' EXIT
sleep 1
N=$(( DUR_MS * FPS / 1000 ))
seq 0 $((N - 1)) | xargs -P "$JOBS" -I{} bash -c '
  i={}; t=$(( i * 1000 / '"$FPS"' ))
  google-chrome --headless=new --disable-gpu --no-sandbox --hide-scrollbars --window-size=1400,631 \
    --virtual-time-budget=6000 --screenshot="'"$FRAMES"'/f_$(printf %04d $i).png" \
    "http://127.0.0.1:'"$PORT"'/static/motion/record.html?t=$t" >/dev/null 2>&1'
echo "rendered $N frames"
ffmpeg -y -loglevel error -framerate "$FPS" -i "$FRAMES/f_%04d.png" -c:v libx264 -pix_fmt yuv420p -crf 21 \
  -vf "crop=1400:560:0:0" -movflags +faststart static/motion/teaser.mp4
ffmpeg -y -loglevel error -framerate "$FPS" -i "$FRAMES/f_%04d.png" -c:v libvpx-vp9 -b:v 0 -crf 32 \
  -vf "crop=1400:560:0:0" static/motion/teaser.webm
ffmpeg -y -loglevel error -i "$FRAMES/f_$(printf %04d $((N - 1))).png" -vf "crop=1400:560:0:0" static/motion/teaser_poster.png
ls -la static/motion/teaser.*
