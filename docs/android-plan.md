# Android beta plan for Syntopico

Created: 2026-10-16. Status: local milestone 1 runtime gate passed 2026-10-24; voice pipeline and EAS readiness pending.

## Resume here next session

Open `docs/android-plan.md`. Start at milestone 1 and record evidence below as each gate passes. Do not move to the next milestone before the current integration works end-to-end in the Android emulator. The owner has no Android phone: local development and verification must work with an emulator. Friends can provide optional physical-device beta feedback.

Goal: ship an installable Android APK to a small group of friends using the existing React Native / Expo app. Keep iOS working. This is platform enablement, not a rewrite.

Deferred: saving failed captures for metadata retry, the retry folder/menu/screen, automatic enrichment of existing books, cross-edition grouping, cloud sync, authentication, social features and on-device AI. Do not implement these as part of this port. Keep the current lookup failure behavior.

## Current repository findings

- Expo SDK 55, React Native 0.83.6, React 19.2.0; native modules include expo-audio, expo-sqlite, expo-file-system, expo-document-picker and Sentry.
- `app.config.js` has Android adaptive icons but no explicit `android.package`. iOS has separate production/development identifiers. Proposed Android equivalents: `com.nnc.syntopico` and `com.nnc.syntopico.dev`; verify availability/ownership before adopting.
- `eas.json` already has development and preview profiles with internal distribution. Production auto-increments remotely. Submission is configured only for iOS. The `bstf` alias is iOS-only; leave it that way.
- Main capture path: `src/hooks/useRecording.ts`. Uses metering, a -40 dB silence threshold, a 1.5-second minimum duration, keep-awake and a five-minute cap. `expo-keep-awake` is imported but not explicitly declared in package.json: audit direct native dependencies before building.
- `src/services/whisper.ts` uploads the recorded URI as `recording.m4a` / `audio/m4a`. Verify Android's actual output container, MIME type and URI rather than assuming the iOS upload works there.
- Metadata flow now has Google Books → Open Library fallback. Do not change lookup semantics while porting.
- Backup export currently uses `Share.share({ message: json })`; the generated cache URI is not actually shared as a file. Import expects a JSON document. Verify the real export/import round trip on Android before claiming backup parity.
- Existing verification debt: five failing recording-hook tests; TypeScript errors in legacy VoiceCaptureScreen/identifyBook and Expo/TypeScript module configuration. Separate baseline failures from Android regressions and fix blockers before beta.
- This Mac is arm64. Initial PATH/default-location checks did not find adb, emulator, Android Studio or an Android SDK; discovery is incomplete. Inspect custom locations before installing anything.
- iOS runtime verification on 2026-10-16 covered forced Google failures, live Open Library, SQLite and native cover rendering; it did not exercise microphone/transcription or Android.

## Delivery choice

Use a signed, standalone **preview APK** through EAS internal distribution for the first friends beta. It must run without Metro, a developer account or Expo Go. APKs can be installed on Android devices and emulators; the normal production AAB is intended for Google Play and cannot be directly installed this way. No Play listing is required for this first delivery. [Expo APK builds](https://docs.expo.dev/build-reference/apk/), [internal distribution](https://docs.expo.dev/build/internal-distribution/).

Keep a stable beta package ID and signing key across updates; increase versionCode. A separate development package avoids overwriting beta data. Let EAS manage signing and record its recovery/ownership arrangements. Add Google Play testing only if sideloading is too inconvenient; research then-current account/testing requirements at that point.

## Milestones and verification gates

### 1. Establish a reproducible Android baseline

- Check out the intended integrated branch: earlier iOS PRs are stacked; do not accidentally port an old main missing shipped behavior.
- Inventory Android Studio, SDK, platform-tools, emulator, JDK and available disk/RAM. Match JDK/SDK versions to the installed Expo SDK 55 native tooling; avoid an unrelated Expo/RN upgrade.
- Configure an ARM64 Pixel-style AVD on this Apple Silicon Mac, using the newest Android API supported by the current toolchain. Add a second supported older API/smaller display after the first works; derive the supported minimum from generated configuration, not a guess.
- Configure explicit Android package IDs and development/preview EAS environments. Audit generated manifest permissions and direct native dependencies; native projects are gitignored, so keep durable changes in Expo config/plugins.
- Create a development build (`eas build --platform android --profile development`), install on the emulator (`eas build:run --platform android`) and connect Metro using this repo's CLI convention (`node node_modules/expo/bin/cli start --dev-client`).
- If needed use `adb reverse tcp:8081 tcp:8081`; emulator localhost refers to the virtual device. Use the host connection appropriate to the actual setup and port.

**Gate:** app cold-starts, fonts/assets load, SQLite initializes, Home and Book screens open, and logs are accessible. Record exact AVD/API/tool versions and build ID.

### 2. Prove the voice capture pipeline

- Enable the emulator's host microphone input (disabled by default) and handle macOS microphone access separately from Android app permission. [Android emulator microphone controls](https://developer.android.com/studio/run/emulator-extended-controls).
- Record an audible spoken sample through the actual UI. Verify duration, file existence/size and playable audio, then upload that file to Whisper and verify the transcript. Inspect metering samples to establish whether -40 dB works on Android; do not weaken silence detection just to hide missing emulator input.
- Complete extraction → metadata → SQLite → displayed note for both a new book and a pinned/existing book. Verify another note reuses the existing book.
- Exercise permission denied/granted/revoked, sub-1.5-second input, silence, unidentified book, manual stop, cancel and the five-minute auto-stop. A shortened temporary cap can help iteration, but restore it and verify the real cap before release.
- Test home/background/lock, incoming-call simulation and returning to the app. Decide and document foreground-only interruption behavior; do not add background-recording services as an incidental fix.

**Gate:** actual emulator microphone → Whisper → extraction → stored/displayed note succeeds. A mocked API test alone cannot pass this gate. Capture/transcription may incur normal provider usage costs.

### 3. Verify Android integrations and UI

- Force Google 503 and incomplete responses at the test boundary while keeping Open Library live; verify metadata, covers and SQLite. Also test no match, both services unavailable, offline and restored connectivity. Remove test interception afterward.
- Verify data persists across app process death/relaunch and installing an updated APK over the same signed package. Uninstall clears local data; warn testers before asking them to reinstall.
- Exercise Amend, Wrong Book, Re-process, note/book deletion, backup export/import, Android document URIs and share-sheet cancellation. Do not request broad storage permissions to bypass scoped-storage issues.
- Check Android Back/back gesture while recording and on overlays/screens; avoid accidental duplicate saves. Test gesture navigation and three-button navigation, edge-to-edge insets, status/navigation bars, FAB placement, scrolling header, blur/elevation, typography and larger font sizes.
- Validate production Sentry capture with a harmless test event and check whether source maps are available; existing profiles disable automatic Sentry uploads. Do not put transcript/audio or API keys into diagnostic logs.
- Run relevant automated tests, baseline-aware type checks and an iOS smoke test after shared-code fixes.

**Gate:** core flow and persistence pass on both AVD configurations; Android changes do not regress iOS. Record unresolved failures explicitly.

### 4. Build and distribute a standalone beta

- Make Android preview output explicit as APK if necessary (`android.buildType: "apk"`) and select the intended EAS environment; do not assume production API variables appear in preview builds.
- Audit bundled credentials. `EXPO_PUBLIC_*` provider keys are extractable from mobile binaries. For a tiny trusted beta, decide the exposure and spending limits deliberately; a protected server-side API is the longer-term mitigation before wider distribution. Never document actual key values.
- Build `eas build --platform android --profile preview`, install that exact APK on a clean AVD and close Metro. Verify first launch, microphone permission, real recording → saved note, metadata fallback and restart persistence.
- Prepare tester notes: installation link, Android's per-source install permission, required network access, local-only data, build/version, known issues and how to report device model/Android version/reproduction steps. Keep APK-link access appropriate for a private beta.
- Share manually with friends when the owner chooses recipients. Do not automatically message anyone as part of implementation.

**Gate:** standalone APK works without Metro. Owner can send friends one installation link and a short test checklist.

### 5. Collect optional hardware evidence

Ask willing friends to try microphone input, quiet-room silence detection, Bluetooth/headsets, background interruptions and an in-place APK update. Collect device model/Android version and redacted logs. If no hardware feedback is available, label the beta **emulator-tested only** and carry the hardware risks forward; do not claim physical-device verification.

## Risks and mitigations

| Risk | Priority | Mitigation / evidence needed |
| --- | --- | --- |
| Emulator succeeds but phone microphone gain, codec, routing or OEM behavior differs | High | Real host-mic integration gate; optional friends test matrix; label hardware coverage honestly. |
| Metering missing/different causes speech to be discarded as silence | High | Inspect Android metering before tuning; verify spoken and silent samples separately. |
| Android recording URI/MIME differs from hardcoded m4a upload | High | Inspect actual recorded file and run live Whisper upload; map filename/type to actual format if needed. |
| App backgrounding/interruption loses an active recording | High | Explicit foreground behavior and lifecycle tests; defer background capture unless deliberately scoped. |
| Exposed provider keys permit unauthorized usage/spend | High | Audit existing EXPO_PUBLIC keys; restricted beta/access and usage controls; plan a server boundary before broad rollout. |
| APK update fails or deletes data due to signing/package changes | High | Stable package/signing identity, increment versionCode, test upgrade without uninstall; verify backup first. |
| Native build/toolchain or transitive module assumptions fail | Medium | SDK-matched tooling; audit expo-keep-awake and stale expo-av references; fix baseline blockers early. |
| Navigation/insets/blur differ across Android versions | Medium | Two AVD/API/display configurations, Back and system-navigation tests, focused platform fixes. |
| Export text cannot be re-imported as a JSON file | Medium | Test real share/document round trip; use a proper JSON file share if required for parity. |
| API outage, preview env mismatch or missing Sentry maps obscures defects | Medium | Deterministic failure injection, live-provider checks, explicit EAS environment and safe production diagnostics. |
| APK ABI coverage differs from local ARM64 emulator coverage | Medium | Confirm release APK includes tester architectures; test x86_64 only if needed by intended targets. |
| Mac emulator performance/disk limits slow feedback | Medium | One AVD at a time; reuse EAS native builds for JS changes; avoid unrelated dependency upgrades. |

## Completion record (fill in during implementation)

- Branch / PR:
- Android package IDs and signing ownership:
- SDK / JDK / emulator / AVD API levels:
- Development build and microphone pipeline evidence:
- Standalone APK link, versionCode and environment:
- Clean-install / upgrade / restart results:
- Automated test and iOS smoke results:
- Friend hardware feedback (or explicitly none):
- Remaining risks / next action:


### 2026-10-21 — milestone 1 preparation

- Created `codex/android-port` from `voice-max-duration` at `0d61f66`, retaining the existing working-tree changes (including metadata fallback and backup work). No reset, stash or commit of those changes.
- Added Android package IDs `com.nnc.syntopico` / `com.nnc.syntopico.dev`, matching the existing iOS naming. These remain provisional until EAS signing/ownership is checked; no signing credentials created.
- Android development EAS config now explicitly sets `APP_VARIANT=development`; preview explicitly produces an APK and increments the remote Android versionCode. iOS profile behavior is unchanged. EAS provider environment availability is still unverified.
- Declared the already-installed Expo-compatible `expo-keep-awake` ~55.0.8 directly in package.json and the lockfile.
- Verification: Expo config introspection succeeded, both resolved package IDs checked, and Android Metro/Hermes export succeeded (1,354 modules, 32 assets). This is JavaScript bundling evidence only, not a native build or emulator test.
- Manifest introspection includes microphone/audio settings, location, legacy storage (through API 32), overlay and foreground media playback permissions. The audio plugin defaults to background playback; review the merged native manifest before beta. No broad storage permission was added for this port.
- Baseline before port edits: Jest 33 passed / 5 failed (all five in useRecording); TypeScript fails on the installed compiler's unsupported Expo module setting, legacy VoiceCaptureScreen's missing expo-av/obsolete note field, and identifyBook nullable title handling. These are still open.
- Tool discovery: no Android Studio in /Applications, no adb/emulator/sdkmanager found in the searched Homebrew/Library locations; standard SDK and JDK locations absent. `/usr/bin/java` is a macOS stub and reports no Java runtime. About 162 GiB free disk. RAM check restricted by sandbox. Broad Library search was stopped after yielding no tools; custom locations remain possible.
- Milestone 1 has NOT passed. Next: install/discover Android Studio + compatible JDK/SDK, create an ARM64 AVD, verify EAS environment/signing, build/install the dev client and exercise cold start, fonts, SQLite, Home and Book screens. Do not proceed to milestone 2 before that gate passes.


### 2026-10-24 — shared test/type-check baseline repaired

- Root cause of all five recording failures: the recorder mock omitted metering, so the silence guard exited before transcription. The old null-title assertions also predated the intentional removal of latest-book guessing (`e9ebf15`); the tests were not updated alongside that change or silence detection (`7a9a44d`).
- Reworked recording tests to deliver an audible metering sample after start resets detection. Assert current no-book rejection behavior for empty and populated libraries; retain recognized-title routing and pinned-book extraction/failure preservation checks. Added silence/threshold, short-recording and empty-transcript guards.
- Upgraded TypeScript from 5.3.3 to 5.9.3 (range ~5.9.2), which understands Expo's inherited `module: preserve` setting. Added `npm run typecheck`.
- Removed the unused VoiceCaptureScreen prototype and its exclusively referenced identifyBook helper. Neither was imported by the active app: App mounts Home/Book and GlobalRecordingUI. This removes the obsolete expo-av dependency reference, flat note field and nullable-title metadata call without changing the active capture pipeline.
- Verification: all 42 Jest tests pass across five suites; `tsc --noEmit` passes. This is shared-code verification, not Android/iOS microphone verification; milestone 1's emulator gate is still pending.


### 2026-10-24 — local Android toolchain configured

- Android Studio Rabbit 1 2026.2.1 installed in `/Applications/Android Studio.app`; its bundled JBR is Java 25. The project's pinned Gradle 9.0 supports Java through 24, so installed Homebrew `openjdk@17` (17.0.20.1) without changing Gradle/Expo versions.
- Installed official ARM64 command-line tools build 15859902 with SHA-256 verification, SDK platform 36, NDK 27.1.12297006 and CMake 3.22.1; existing Build Tools 36.0.0 and platform-tools 37.0.1 retained.
- Added SDK/JDK/PATH exports to `~/.zprofile`; fresh login-shell check resolves Java, adb, emulator and sdkmanager. IDE-bundled Java remains unchanged.
- Generated gitignored native Android project using `APP_VARIANT=development node node_modules/expo/bin/cli prebuild --platform android --no-install`; generated package is `com.nnc.syntopico.dev`. Local SDK path is in gitignored `android/local.properties`.
- Emulator 37.2.12 boots existing `Medium_Phone_API_37.0` ARM64 AVD, Android 17/API 37. `sys.boot_completed=1`, ADB reports `device`, Hypervisor.Framework acceleration available. Compile/target API stays 36; minimum API is 24 from the installed React Native version catalog.
- `./gradlew --version` succeeds on JDK 17. Local ARM64 debug APK build started with `APP_VARIANT=development SENTRY_DISABLE_AUTO_UPLOAD=true ./gradlew :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=2 --console=plain`.
- Android Metro uses port 8082 (`APP_VARIANT=development node node_modules/expo/bin/cli start --dev-client --localhost --port 8082`) because another existing session owns 8081. Added `adb reverse tcp:8082 tcp:8082`.
- This local build is a faster baseline alternative to the plan's EAS development build; it does not establish EAS signing/environment readiness. App installation/cold-start gate is not yet claimed.


#### Local baseline result

- Local native build **passed** in 5m 9s (391 executed tasks). ARM64 development APK: `android/app/build/outputs/apk/debug/app-debug.apk`, about 69 MiB, SHA-256 `075d4ad4976a47544d07b1494225a8487f8656fa051166c6cfac2a0c5c687ad3`. It is locally debug-signed; this is not the standalone friends-beta build or an EAS build ID.
- Installed with `adb install -r`; launched development-client deep link against `http://127.0.0.1:8082`. Metro bundled Android successfully.
- Verified rendered Home/empty state and custom fonts; inspected emulator SQLite database and confirmed `books` and `reading_sessions` tables exist.
- Seeded one clearly labelled synthetic book/note (`Android smoke test (sample)`) in the fresh emulator database only. Force-stopped/relaunched; Home rendered the persisted row. Tapped it and verified Book screen renders title, author, chapter and note. Returned using Android Back. No microphone/provider requests were used for this fixture.
- Local runtime portion of milestone 1 passes: cold start, fonts/assets, SQLite, Home/Book navigation and logcat access. EAS development environment/signing checks remain pending; do not interpret this as EAS distribution readiness.
- Emulator and Android Metro on port 8082 were left running. Existing Metro 8081 was retained. Fresh terminal sessions read `~/.zprofile`; already-open terminals can run `source ~/.zprofile`.
- New SDK command-line tools report version 22.0 and work under JDK 17. `sdkmanager` is now a deprecated alias for the vendor's newer Android CLI. The native build also auto-installed Build Tools 35.0.0 for a dependency while app compile/target stays 36.
- Non-blocking upstream warnings: SDK XML version mismatch, deprecated Android/Gradle APIs, dev-launcher appearance reflection, iOS-only navigation font props ignored on Android, and missing expo-system-ui for explicit system appearance. No app startup fatal error observed; Sentry/source-map production setup remains a later gate.
- Next action: milestone 2, configure emulator host microphone input and prove actual spoken audio → Whisper → extraction → SQLite → displayed note. UI fixture does not verify recording, metering, transcription, metadata or physical hardware behavior.


#### First manual capture — emulator microphone setup

- Owner reported recording starts but ends with "Didn't catch anything". Android `RECORD_AUDIO` permission is granted. App uses this alert for either no metering above -40 dB or an empty Whisper transcript, so the alert alone does not identify the branch.
- Emulator was started without host audio opt-in. Official emulator docs state host microphone input is disabled by default; virtual mic hardware being present (`hw.audioInput=yes`) does not enable host input.
- Enabled host input on running AVD with `adb -s emulator-5554 emu avd hostmicon`; emulator returned `OK`. This may also require macOS microphone approval. Host-mic opt-in must be re-enabled after restarting the emulator.
- Next: owner repeats a spoken recording; if still rejected, inspect metering/file audio and macOS mic access before changing silence thresholds. No application code or silence threshold changed. Live microphone/Whisper gate remains pending.


### Android launcher icon mask correction

- The shared 1024px square artwork was being used as an adaptive foreground without Android mask padding, clipping the S. Kept all original image files unchanged, including iOS icon/splash (SHA-256 `d41fa05c225bf3bda68cdc478e35655ff2ced6aa3c564b14b3e509615cb06895`).
- Added `plugins/withAndroidIconInsets.js`, an Android-only finalized Expo mod that wraps the generated foreground in a 16% inset on each edge for both regular and round adaptive icon resources. The mod runs after native icon generation and is omitted from introspection; durable source survives regeneration of gitignored android/.
- Changed adaptive background to matching solid `#FCFAF4`; removed references to Expo's placeholder background/monochrome artwork rather than shipping its template themed icon. Custom themed-icon artwork is not provided by this change.
- Verification: native build passes; updated emulator APK in place, visually confirmed whole S and blue dot in the actual round launcher icon. Repeated prebuild regenerates both wrappers correctly; Expo introspection passes. Existing iOS configuration and images unchanged.


### 2026-10-25 — physical Samsung tablet baseline and FAB clearance

- Owner connected SM-X210 (Galaxy Tab A9+), Android 16/API 36, ARM64. Installed development APK in owner profile and connected Metro over USB port 8082. App runtime starts and SQLite initializes; owner reports successful spoken recording on physical hardware.
- Owner reported Samsung bottom taskbar/navigation bar overlaps the FAB. Observed bottom navigation inset 72 physical px at density 240 (=48dp); GlobalRecordingUI had fixed bottom:30 and ignored Android system insets.
- GlobalRecordingUI now uses `30 + insets.bottom` on Android through react-native-safe-area-context; iOS retains bottom:30. Verified live on the tablet after Fast Refresh: full button/halo sits above taskbar. `npm run typecheck` and `git diff --check` pass. Other navigation modes/orientations remain part of the broader UI gate.


### 2026-10-25 — standalone preview build requested

- Added `android-preview` EAS profile extending the APK preview profile, explicitly selecting the existing production EAS environment (preview environment was empty). Existing production variables provide transcription, extraction, metadata and Sentry configuration; values were not printed or copied to source.
- Added `.easignore` preserving existing ignore rules and excluding local writing/planning, seed scripts/data and agent instructions. Cloud archive includes current working-tree application fixes, including uncommitted Android/icon/FAB changes; the build's displayed Git commit alone does not describe the full uploaded archive.
- Tests: 42 passed across five suites; typecheck passed before submission.
- Submitted EAS internal-distribution build `e38b27f2-7a02-4b5e-987f-7355619840dd`, package `com.nnc.syntopico`, version 1.0.0, remote versionCode 2. Expo generated and manages the Android signing keystore in the Syntopico account. Future updates must reuse this key and package.
- Build URL: https://expo.dev/accounts/syntopico/projects/bookbuddy/builds/e38b27f2-7a02-4b5e-987f-7355619840dd
- Standalone package installs beside `com.nnc.syntopico.dev` with a separate local library. No development data is deleted or implicitly migrated.
- Tester instructions: `docs/android-beta-testing.md`. Build completion and no-Metro verification pending.


#### Standalone artifact result

- EAS build **FINISHED** successfully. Exact artifact: https://expo.dev/artifacts/eas/a1-V7aFAQKLkOXdWIncVYYWmec4VVi6aYSfMIA_g7VM.apk
- Downloaded to gitignored `dist/syntopico-1.0.0-2.apk` (80.5 MiB), SHA-256 `a6aaf7ba379ee40538b6f875c1bc0eeb309944b0972b9610be33d7b3a575bc76`. Verified APK signature; signer SHA-256 `d081246b71671145d627edee00372b893376c36d881b87633805ea41491b70bd`.
- Manifest: package `com.nnc.syntopico`, versionName 1.0.0, versionCode 2, minimum API 24, target API 36, debuggable=false. APK includes arm64-v8a, armeabi-v7a, x86 and x86_64; `assets/index.android.bundle` and 16 bundled font files present. Confirmed expected provider configuration is embedded without printing values.
- Installed exact APK on Samsung SM-X210 owner profile and ARM64 emulator, alongside development app. Removed port 8082 reverse forwarding on both devices. Both standalone processes report running main without startup fatal errors. Emulator Home/fonts/FAB visually verified after process restart. Tablet was screen-locked during visual verification; requested owner unlock/open Syntopico (not Dev), unplug USB and confirm a spoken note saves.
- No claim yet for standalone live-microphone capture, update-over-existing-release persistence or complete beta gate. Development-package notes were preserved; release library is intentionally separate. Broader interruption/back/backup/second-AVD UI checks remain open.


- Owner confirmed standalone tablet test: **spoken note saves successfully with USB unplugged**. This verifies the standalone physical microphone → transcription/extraction → displayed saved note path without Metro. Android Metro port 8082 was stopped for the additional emulator cold-start check; existing unrelated Metro 8081 was left intact.
