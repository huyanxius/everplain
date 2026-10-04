#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
[[ "$(uname -s)" == Darwin ]] || { echo 'A macOS host with Xcode is required for the native app.' >&2; exit 2; }
CONFIGURATION="${1:-release}"
[[ "$CONFIGURATION" == release || "$CONFIGURATION" == debug ]] || { echo 'Usage: build-app.sh [release|debug]' >&2; exit 2; }
python3 scripts/sync-shared.py --check
python3 scripts/generate-avatars.py --check
python3 scripts/generate-brand.py --check
python3 scripts/generate-icons.py --check
python3 scripts/verify-assets.py
python3 scripts/verify-export-resources.py
python3 Tests/LibraryNativeParityChecks/resource-integrity.py --web-source DesignSources/graph/ObsidianKnowledgeGraph.tsx
swift test
swift build -c "$CONFIGURATION" --product Everplain
BIN_DIR="$(swift build -c "$CONFIGURATION" --show-bin-path)"
BUNDLE=".build/Everplain.app"
mkdir -p "$BUNDLE/Contents/MacOS" "$BUNDLE/Contents/Resources"
[[ -d "$BIN_DIR/Everplain_EverplainMac.bundle" ]] || { echo "Missing native export resources" >&2; exit 3; }
cp -R "$BIN_DIR/Everplain_EverplainMac.bundle" "$BUNDLE/Contents/Resources/"
cp "$BIN_DIR/Everplain" "$BUNDLE/Contents/MacOS/Everplain"
cp Configuration/Info.plist "$BUNDLE/Contents/Info.plist"
if [[ "$CONFIGURATION" == debug ]]; then
  /usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity dict' "$BUNDLE/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :NSAppTransportSecurity:NSAllowsLocalNetworking bool true' "$BUNDLE/Contents/Info.plist"
fi
/usr/bin/plutil -lint "$BUNDLE/Contents/Info.plist"
echo "Built unsigned local app at $PWD/$BUNDLE. Signing, notarization and distribution are not performed."
