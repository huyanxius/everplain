# Android validation record

Date: 2026-10-04. Native Kotlin/Compose candidate; remaining QA is explicitly
tracked below. No live account or paid model call has been performed.

## Passed

- Generated contract Kotlin compilation and native Compose compilation.
- `:core:test`: 13 JUnit tests, 0 failures. This includes the shared codec/SSE
  corpus, original-key read-only lookup, cookie session continuity and isolation,
  HTTPS endpoint validation, POST streaming/replay keys, cancellation, Stop,
  premature EOF, MIME validation, 401/403/409 errors and redirect rejection.
- `:app:assembleDebug` and `:app:assembleDebugAndroidTest`.
- `:app:lintDebug`: 0 errors. Remaining warnings are dependency/KTX suggestions.
- Debug APK `apksigner verify`: valid APK v2 debug signature. App ID
  `app.everplain.android`, version `0.1.0`, minimum API 26, target API 35.
- Actual Android 35 AOSP ATD emulator boot using software CPU emulation and
  SwiftShader; no KVM or host-security change. Test APKs installed on the device.
- Complete Android device suite: 3/3 instrumentation tests passed (161.177 seconds):
  `ScreenshotFixtureTest`, `NativeKeyboardTest`, `NativeFlowTest`.
  Four native pages, drawer/Back, Agent draft preservation across navigation,
  dark mode, 1.5x font and 320dp width were checked. Real keyboard tests used
  UiAutomator and platform IME insets, not Compose's test input interceptor:
  pasted Chinese, Back/text preservation, first Home send while streaming,
  Agent editor above the keyboard and Save remaining reachable all passed.
  Real Android keyboard pixels are present in the keyboard screenshots.
- The device flow test drives the real ViewModel with a test-only transport:
  duplicate exclusion, pre-start cancellation, no replay while Stop is unknown,
  original body/key recovery, Stop confirmation, late Stop response isolation,
  Agent CAS 409 review/reapply, and 401 account isolation.
- The later native Markdown rendering increment compiles and passes lint. Its
  additional native-span/rendering device rerun is pending; the prior 3/3 result
  must not be presented as proof of that later increment.

The instrumentation fixtures and fake transport exist ONLY in `androidTest`.
Neither the runtime APK nor production login has a fixture switch or mock data.
All displayed names, email, quota and model values in test images are synthetic.
The screenshot/flow tests are not real backend, account, model or billing proof.

## Fixes found during verification

- Cancelled OkHttp reads now preserve coroutine cancellation instead of surfacing
  an IOException and orphaning work.
- Source-derived neutral colors, compact mobile composer/model summary, original
  avatar geometry, source Agent field/selector hierarchy and account categories
  replaced the initial generic Material layout. The Bot tab is icon-only.
- Home and Chat now keep one continuously mounted native editor. Moving a
  remembered editor between lazy/ordinary containers still lost focus; the
  shared fixed child resolves the real first-send IME regression. In-flight
  input mutations remain rejected by the ViewModel without ending the platform
  input session.
- Account and Agent form state is retained across navigation within the same
  authenticated owner, and is isolated when that owner changes.
- JSON response body reads/decoding are on IO, including slow bodies received
  after headers. Cancellation closes both JSON and SSE transports promptly.
- Ending local Stop waiting keeps in-memory and encrypted outcome state aligned;
  generation and request-key guards exclude late Stop results from a newer chat.
- Android window icon contrast uses `LocalActivity` and current appearance.
- All recoverable intents are encrypted and scoped to both account and API
  origin; leaving an uncertain run retains it for later read-only rechecking.
- Pre-start Stop does not claim server cancellation before it is known. Ending
  local waiting never silently replays a turn.
- Agent and account edits use captured optimistic versions and stable retry keys.

## Remaining QA/release gates

- Final device rendering rerun for the subsequently added native Markdown renderer.
- Native hardware/Chinese Pinyin composition, performance and physical-device
  coverage. Pasted/semantic Unicode text is not proof of a Pinyin IME session.
- Four-page pixel comparison against the current rendered Web at the same
  viewport. TSX/CSS were inspected; without an actual Web reference render we do
  not claim pixel-identical visual acceptance.
- The owner-scoped run-key lookup backend patch must be deployed separately for
  authoritative pre-start recovery. Its absence returns an outcome-unknown
  state; 404 never proves a request did not execute.
- Live login/session/model/Stop/CAS checks against the intended deployment.
- Release signing, store distribution and installation on the user's device.

## Environment notes

SDK Platform 35/Build Tools 35.0.0 were installed only after the user explicitly
accepted the Google Android SDK License Agreement. Emulator/AOSP image terms
were the same verified agreement. Full JDK 21 was installed from the official
Adoptium distribution; the preinstalled Java was only a JRE. Tool caches and AVDs
are kept in workspace storage rather than the RAM-backed temporary filesystem.
ATD disables drawing by default; the official AndroidX capture API enables the
native renderer. Initial cold software-emulator startup hit Android ANR limits;
package verification/warm-up permitted subsequent instrumented tests to pass.
A full AOSP image stalled before ADB became available; no security controls were
disabled to force it to boot. ATD drawing was enabled using the Android hardware-renderer testing switch;
subsequent captures include actual system keyboard pixels. Long-running software
GPU use caused memory pressure, so completed emulators are stopped before builds.


## 2026-10-04 08:58 UTC authentication/motion checkpoint

- The expanded 274-schema generated Kotlin contract compiled; 15 protocol tests
  pass including all 21 shared SSE framing cases, seven expanded module codec
  round trips (including exact integers above 2^53), and code/register cookie
  transport using local synthetic fixtures.
- Four additional pure motion tests pass: surrogate-safe pacing, reduced-motion
  and replacement handling, terminal backlog drain, source spring overshoot.
- APK and Android test APK assembly pass. Lint: 0 errors / 11 warnings (dependency
  updates and non-blocking style/API recommendations).
- Frozen APK SHA-256:
  `585fb4a4d47d3762f5bd0e03756382aca0ac4480aa637a372f42bb4dfaf73fd7`.
- This revision is NOT yet device-accepted. Two prior final-parity software
  emulator attempts ended with timeouts/disconnection. The latest lavapipe attempt
  booted in 188 seconds but its QEMU CPU0 thread hung during test APK installation;
  no tests began. A serialized, build-free device run is now in progress.
- The later shared 277-schema addition is not covered by the frozen 274-schema
  build. It will be compiled in the next module integration round.
- Expanded library/files/graph/research/account functionality remains in progress;
  do not call this checkpoint the full requested migration.


### Device completion, 2026-10-04 09:12 UTC

The frozen SHA-256 above passed all four real Android test classes on the API35
ATD software emulator, after warm package compilation (`cmd package compile -m
speed -f`) resolved a cold instrumentation process-start ANR:

- NativeSmokeTest: 1/1, 65.556 seconds. Email validation, email/password transition,
  Back retained email, registration first step; no network submission.
- NativeKeyboardTest + NativeFlowTest + ScreenshotFixtureTest: 3/3, 193.628 seconds.
  Actual visible Android IME, Home-to-chat focus retention, no invented speaker
  headings, read-only in-flight input, Agent editor and reachable Save, pre-start
  cancellation, durable recovery, late Stop isolation, CAS conflicts, session
  expiry isolation, native Markdown spans, dark mode, narrow viewport and enlarged
  text all passed.
- 22 actual native framebuffer PNGs were exported. Four page Library images are
  version3, two real-IME Library images version1, new login/register images version0.
- Screenshot tests deliberately reduce motion. The four motion implementations
  have compilation/numerical checks, but dynamic playback and same-viewport Web
  pixel comparison remain separate open visual acceptance items.
- Subsequent generated 277-schema operation wrappers and module work are newer
  than this frozen APK. Their verification must be reported separately.


### Follow-on compatibility correction (not yet in frozen checkpoint)

Inspection of CommonMark 0.24 bytecode found `java.util.List.of()` calls. The frozen
APK was device-tested on API35 only; older Android levels must not be declared
accepted. The next build enables Google's `desugar_jdk_libs:2.1.5` for API26–29
compatibility (official Java API desugaring guidance and upstream changelog), and
keeps both UTF-16 units of a revealed surrogate pair inside one visual span.
These source changes require the next build/device check.


Compatibility references:
- https://developer.android.com/studio/write/java8-support
- https://github.com/google/desugar_jdk_libs/blob/master/CHANGELOG.md

The next module batch contains source-generated typed JSON operations, account
identity/notification controls, the distinct mobile Soul drawer, and personal
memory CRUD/settings/history/overview with server CAS and owner-scoped encrypted
uncertain-write journals. It is not part of the frozen APK until its subsequent
compile and tests are recorded.
