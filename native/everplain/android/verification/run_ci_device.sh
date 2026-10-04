#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p verification/ci-results
adb wait-for-device
adb shell wm size 390x844
adb shell wm density 160
adb shell settings put system font_scale 1.0
adb shell settings put secure show_ime_with_hard_keyboard 1
adb shell setprop debug.hwui.drawing_enabled true
adb install -r app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell cmd package compile -m speed -f app.everplain.android
adb shell cmd package compile -m speed -f app.everplain.android.test
sha256sum app/build/outputs/apk/debug/app-debug.apk > verification/ci-results/APK-SHA256.txt
result=0
for test in NativeAccountFeatureTest NativeMarkdownMappingTest NativeMotionPlaybackTest NativeSmokeTest NativeKeyboardTest NativeFlowTest ScreenshotFixtureTest; do
  log="verification/ci-results/$test.log"
  timeout 180 adb shell am instrument -w -e class "app.everplain.android.$test" app.everplain.android.test/androidx.test.runner.AndroidJUnitRunner > "$log" 2>&1 || result=1
  cat "$log"
  grep -Eq '^OK \([1-9][0-9]* tests?\)' "$log" || result=1
  if grep -Eq 'FAILURES!!!|INSTRUMENTATION_FAILED|Process crashed' "$log"; then result=1; fi
done
adb logcat -d > verification/ci-results/logcat.txt || true
adb pull /sdcard/Android/data/app.everplain.android/files/visual-fixtures verification/ci-results/screenshots || result=1
exit "$result"
