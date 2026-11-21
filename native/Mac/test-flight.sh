#!/bin/bash
set -euo pipefail
project="$(cd "$(dirname "$0")" && pwd)"
temp="$(mktemp -d)"
trap 'rm -rf "$temp"' EXIT
xcrun clang++ -std=c++17 -O2 -Wall -Wextra -Werror -framework JavaScriptCore \
  "$project"/Source/Ridgeline/{AlpineTerrain,MacFlight}.cpp "$project/Tests/FlightSmoke.cpp" -o "$temp/test"
"$temp/test" "$project/../../src/flight.js"
