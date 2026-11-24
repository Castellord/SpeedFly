#!/bin/bash
set -euo pipefail
project="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$project/../.." && pwd)"
engine="${UE_ROOT:-/Users/Shared/Epic Games/UE_5.6}"
if [[ ! -x "$engine/Engine/Build/BatchFiles/RunUAT.sh" ]]; then
  echo "Unreal Engine missing at $engine. Set UE_ROOT to an installed UE 5.6+ directory." >&2
  exit 1
fi
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
target="$project/Ridgeline.uproject"
mkdir -p "$project/Intermediate/SourceArt" "$project/Content/Flight"
cp "$repo/src/flight.js" "$project/Content/Flight/flight.js"
sips -s format jpeg "$project/Art/meadow.webp" --out "$project/Intermediate/SourceArt/Meadow.jpg" >/dev/null
sips -s format jpeg "$project/Art/cliff.webp" --out "$project/Intermediate/SourceArt/Cliff.jpg" >/dev/null
"$engine/Engine/Build/BatchFiles/Mac/Build.sh" RidgelineEditor Mac Development -Project="$target" -WaitMutex
rm -f "$project/Intermediate/art-ready"
"$engine/Engine/Binaries/Mac/UnrealEditor-Cmd" "$target" -unattended -nosplash -stdout \
  -run=pythonscript -script="$project/Scripts/prepare_art.py"
test -f "$project/Intermediate/art-ready"
"$engine/Engine/Build/BatchFiles/RunUAT.sh" BuildCookRun -project="$target" -noP4 \
  -platform=Mac -architecture=arm64 -clientconfig=Development -build -cook -stage -pak -package \
  -archive -archivedirectory="$project/Builds" -utf8output
find "$project/Builds" -name '*.app' -prune
