#!/usr/bin/env bash
set -euo pipefail

# Record a local benchmark run, then create a small privacy-friendly MP4.
# Requires: ffmpeg (Homebrew: brew install ffmpeg)
# Device selection: export CAPTURE_DEVICE_INDEX=<n> from `ffmpeg -f avfoundation -list_devices true -i ""`

OUT_DIR=${1:-"$HOME/Library/Application Support/Idena/ai-benchmark/videos"}
DURATION_SECONDS=${CAPTURE_SECONDS:-95}
CAPTURE_DEVICE_INDEX=${CAPTURE_DEVICE_INDEX:-1}
CAPTURE_FPS=${CAPTURE_FPS:-12}
CAPTURE_SIZE=${CAPTURE_SIZE:-1280x720}

mkdir -p "$OUT_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
RAW_MOV="$OUT_DIR/ai-test-run-${STAMP}-raw.mov"
FINAL_MP4="$OUT_DIR/ai-test-run-${STAMP}-small.mp4"

ffmpeg -y \
  -f avfoundation \
  -framerate "$CAPTURE_FPS" \
  -pixel_format bgr0 \
  -video_size "$CAPTURE_SIZE" \
  -i "${CAPTURE_DEVICE_INDEX}:none" \
  -t "$DURATION_SECONDS" \
  -an \
  -c:v h264_videotoolbox \
  "$RAW_MOV"

ffmpeg -y \
  -i "$RAW_MOV" \
  -vf "fps=10,scale=960:-2:flags=lanczos,format=yuv420p" \
  -an \
  -c:v libx264 \
  -preset veryfast \
  -crf 30 \
  -movflags +faststart \
  -map_metadata -1 \
  "$FINAL_MP4"

rm -f "$RAW_MOV"

echo "Saved: $FINAL_MP4"
