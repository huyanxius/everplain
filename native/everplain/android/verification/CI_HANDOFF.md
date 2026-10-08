# Account / Soul / Memory checkpoint for independent KVM QA

Frozen 2026-10-04 10:25 UTC. This is an intermediate checkpoint, not completion of all expanded Web modules.

- Existing debug APK SHA256: `3c40437e76bc99d7620c01a6869fa360f631eb18b398173908d344cc170579e5`.
- Local build, lint, 19 core tests and 6 MemoryController tests passed before freeze.
- The software-emulated API 35 device was killed by the host during the new account test. No current instrumentation result or new image is accepted.
- Earlier auth/motion checkpoint `585fb4a4d47d3762f5bd0e03756382aca0ac4480aa637a372f42bb4dfaf73fd7` passed four prior instrumented tests. Those results do not apply to this checkpoint.
- This source snapshot includes the later, not locally compiled `NativeFileTransport.kt` / multipart-binary methods. They are not used by these UI tests and are not in the frozen APK. Compile source independently before claiming source validation.
- No secrets, local SDK location or credentials are included. Synthetic transport and fixtures exist only in the instrumented test APK. Main app has no demo entry point.

## Build in archive root

JDK 21, Android SDK platform/build-tools 35, Gradle 8.11.1 wrapper. A runner with Android SDK already installed can use ANDROID_HOME; no local.properties is required.

```
cd android
./gradlew --no-daemon --max-workers=1 :core:test :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

## Run against a booted Android 35 emulator

Prefer KVM x86_64 on the runner. No production backend requests are needed. Use a fresh emulator. The fixture screen size is 390 x 844 mdpi. The instrumentation controls global animator scale for the tests and restores reduced motion after its one explicit animation playback test. All screenshots must be captioned synthetic.

```
adb wait-for-device
adb shell wm size 390x844
adb shell wm density 160
adb shell settings put system font_scale 1.0
adb shell settings put secure show_ime_with_hard_keyboard 1
adb shell setprop debug.hwui.drawing_enabled true
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb install -r android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk
adb shell cmd package compile -m speed -f app.everplain.android
adb shell cmd package compile -m speed -f app.everplain.android.test
adb shell am instrument -w -e class app.everplain.android.NativeAccountFeatureTest,app.everplain.android.NativeMarkdownMappingTest,app.everplain.android.NativeMotionPlaybackTest,app.everplain.android.NativeSmokeTest,app.everplain.android.NativeKeyboardTest,app.everplain.android.NativeFlowTest,app.everplain.android.ScreenshotFixtureTest app.everplain.android.test/androidx.test.runner.AndroidJUnitRunner
adb pull /sdcard/Android/data/app.everplain.android/files/visual-fixtures screenshots
```

Always capture instrument stdout, logcat, APK SHA256, build/test XML and screenshots even on failure. A Gradle exit code alone does not establish instrumentation or visual acceptance. Read `INSTRUMENTATION_FAILED`, test failure traces and `OK (N tests)` explicitly. Pull screenshots before stopping a read-only AVD. Running each test class separately can preserve independent results and simplify crash triage.

## Test purposes

- NativeAccountFeatureTest: original account menu; Soul draft close/reopen; actual Memory editor validation and synthetic save/overview.
- NativeMarkdownMappingTest: Markdown/entity/emoji/code-block raw-source alignment; bold terminal stability.
- NativeMotionPlaybackTest: live native Liquid frames differ; paced native Markdown drains after terminal answer.
- NativeSmokeTest: email-first login/password/back/register screens; local validation, no real submission.
- NativeKeyboardTest: real software IME, first home send stays focused; Agent editor IME.
- NativeFlowTest: synthetic streaming stop before start, same intent recovery and stale-generation isolation.
- ScreenshotFixtureTest: four pages, dark mode, large type/narrow view capture.

The live site, file upload, actual email delivery, model billing and authenticated production operations have not been exercised by these tests. Source implementation beyond the original pages remains active work.
