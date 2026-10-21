# Android beta plan for Syntopico

Created: 2026-10-16. Status: planning only; no Android port work started.

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
