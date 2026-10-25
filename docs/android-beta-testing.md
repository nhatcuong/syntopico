# Syntopico Android preview

Build profile: `android-preview` (APK, internal distribution, production provider environment).
Package: `com.nnc.syntopico`. Version: 1.0.0; versionCode: 2.

This is the standalone app. It does not require Expo Go, Metro, a Mac or a USB cable. Internet access is still needed for transcription, extraction and book metadata.

## Install

Open the private EAS installation link on the Android device and download the APK. Android may ask you to allow installation from that browser or file manager. Install and open **Syntopico**. It is separate from **Syntopico (Dev)** and starts with its own empty library.

Notes are local to that installation; development-app notes are not automatically copied. Keep the same package/signing key for updates. Do not uninstall to update: uninstalling clears local data.

## First checks

1. With the USB cable disconnected, launch Syntopico.
2. Allow microphone permission and speak a 5–10 second note with a book title, author if known, and a thought.
3. Stop recording; verify the book and note appear. Google Books may be unavailable; Open Library fallback is expected.
4. Close and reopen the app; verify the note remains.
5. Check that the record button clears Android's bottom navigation/taskbar.

Record any issue with device model, Android version, build version, and the steps that caused it. Avoid sharing private transcripts or API keys in logs.

## Distribution and signing

Build: https://expo.dev/accounts/syntopico/projects/bookbuddy/builds/e38b27f2-7a02-4b5e-987f-7355619840dd

Signing is managed in the existing Syntopico Expo account. Authorized maintainers can inspect/download Android signing credentials with `eas credentials --platform android`; preserve the same signing identity for future APK updates. Do not commit signing credentials.

This preview uses the same client-bundled provider configuration as the existing app; keep distribution to the intended trusted test group.

Build completed and installed on tablet/emulator. Emulator startup without Metro forwarding verified; owner confirmed a standalone spoken note saves on the tablet with USB unplugged. Full evidence is in `docs/android-plan.md`.

Direct APK: https://expo.dev/artifacts/eas/a1-V7aFAQKLkOXdWIncVYYWmec4VVi6aYSfMIA_g7VM.apk
