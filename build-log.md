# Build Log

## Session 19 — 2026-09-12

### What we did
- **Brainstormed voice-capture edge cases**: what happens when the user taps record but says nothing, or says something unrelated to a book — anchored on a real, lived failure ("I say nothing, Whisper returns something like 'Silence', and Claude looks for a book with 'Silence' in the name")
- Settled on a common failure shape for both silence and (next session) "no book detected": the recording overlay closes and a plain native `Alert.alert` (title + message + OK, no retry button) tells the user nothing was saved — no "save as general note" fallback, since that's out of scope for what's meant to be an edge case
- **Implemented silence detection** in `useRecording.ts`:
  - Enabled `isMeteringEnabled` on the `expo-audio` recorder and track whether any live metering sample crosses `SOUND_THRESHOLD_DB` (-40dB, a first guess that needs on-device tuning) during the recording, via the same poll that already drives the duration timer
  - If no sample ever crossed the threshold, skip the Whisper API call entirely and show the alert — cheaper than any post-hoc check, since it never spends an API call on dead air
  - Kept the existing post-Whisper empty-transcript check as a second net (covers non-silent but non-speech sound, e.g. rustling), now wired to the same alert instead of silently resetting to idle
  - Verified end-to-end on the simulator: a silent recording now shows "Didn't catch anything" instead of being sent to Whisper/Claude
- **Pulled PR #24 into this branch locally** (fast-forward merge, stashing/reapplying uncommitted work around it) after the user was confused why the simulator still showed the old UI — PR #24 was already stacked on top of this branch on GitHub, it just hadn't been pulled locally yet

### Decisions made
- Silence and no-book-detected both resolve to the same UX shape (overlay closes → native alert → discard, no retry, no fallback save) rather than each growing its own bespoke handling
- Chose on-device metering over two alternatives considered and rejected: a hardcoded Whisper-hallucination phrase blocklist (English-only, brittle, misses variants) and parsing OpenAI's `verbose_json`/`no_speech_prob` per-segment confidence (turned out to be about as much implementation work as on-device detection, with an added API cost)
- "No book detected" handling (the `title: null` path in `extractBookInfo`) deferred to next session — scoped separately from silence detection even though they share the same alert pattern

### Next session
- Implement "no book detected": stop `useRecording.ts` from silently falling back to the last-read book when `extractBookInfo` returns `title: null`; tighten that field's schema description so the LLM doesn't guess a title from stray/filler transcript text (the "Silence" bug)
- `SOUND_THRESHOLD_DB` (-40dB) needs real-device tuning across a few different rooms/mic conditions, not just simulator taps
- Commit the pre-existing, unrelated local changes to `build-log.md` (Session 17 entry) and `scripts/seed_dev_db.py` (`--prod` seeding flag) into PR #21 separately — left untouched here since they predate this session
- `book-header-collapse-fix` (#21) still needs merging to `main`, which will require retargeting PR #24's base branch afterward

### Not vibe
- Diagnosed the actual bug from one concrete, lived anecdote (Whisper transcribing silence as "Silence", Claude matching it to a book by that name) rather than an abstract spec — that example anchored every downstream design choice, including today's schema-tightening plan
- Rejected the "save as general note" fallback outright as scope creep for what should stay a narrow edge case, keeping the fix to detect-and-discard only
- Chose a plain native alert (title + message, OK only, no retry) over a custom overlay error state, correctly judging that tapping the FAB again already is the retry
- Pushed back twice on the detection approach: first questioning whether a hardcoded hallucination-phrase blocklist was really the best plan, then — after Claude's countered `verbose_json`/`no_speech_prob` proposal — noticing it had become just as complex as on-device detection and asking to go back to that instead; the on-device metering design only happened because of that second correction
- Recognized "still seeing the old interface" as a stale-local-branch problem rather than a code bug, and asked the precise scoping question ("do I need restarting the sim?") that kept the fix to a plain JS reload instead of a bigger rebuild
- Asked directly whether stacked PRs are possible, prompting confirmation that `book-header-collapse-fix` → `global-fab-and-scroll-fix` was already organized that way on GitHub

## Session 18 — 2026-09-11

### What we did
- **Rewrote the home screen empty state** (PR #22, merged to `main`) — replaced "No books yet" / "Tap below to record your first note" with "What are you reading?" + a short hairline divider + a subtitle that spells out the voice-note format ("Say the book, the chapter, and what's on your mind, like you're talking to a friend!"), dropping the explicit "tap below" instruction since the FAB's own shadow/glow/breathing animation already signifies it's tappable
  - Landed on the copy via a detour through *The Design of Everyday Things* — specifically the chapter 2 idea that conceptual models are a form of story, which reframed the subtitle from an instruction into a demonstrated example utterance
  - Iterated layout for a dozen+ rounds on real simulator screenshots: left-align vs. center, block width/squareness, divider width/weight/spacing, font sizes relative to the `Wordmark` logo (settled on 22pt title / 19pt subtitle)
- **Fixed the FAB sitting too high on the book screen** (PR #23, merged into `book-header-collapse-fix`) — root cause: the collapsing-header work's `content` wrapper View (added so the hero overlay gets the top safe-area inset) also pulled the FAB into excluding the *bottom* safe-area inset from its own positioning box, a ~34pt regression vs. the home screen. Fixed by moving the FAB back out to be a direct `SafeAreaView` child
  - First diagnosis of this bug was backwards (see Not vibe) — corrected after re-measuring pixel positions on both screens
- **Seeded a single real quote+thought note** (Calm Parents, Happy Kids, ch. 5, p. 237 — "Helicoptering comes from fear...Choose love.") into the dev DB for a screenshot, by temporarily swapping `scripts/seed-data/*.json` out and back rather than editing the checked-in seed files
- **Architecture refactor, proposed by the user (see Not vibe), not requested as a bug fix**:
  - Hoisted the FAB and `RecordingOverlay` out of `HomeScreen`/`BookScreen` into one persistent instance rendered as a sibling of the `Stack.Navigator` (`GlobalRecordingUI`, driven by a new `FabController` context) — each screen now just registers "what pressing the FAB should do right now" via `useFocusEffect`, including `BookScreen`'s three-way branching (plain note / amend / wrong-book). The FAB is now one component instance that screen push/pop transitions never touch
  - Extracted `CentralInfoDisplay` (title + divider, shared by the empty state and the recording overlay) positioned with a fixed offset from the safe-area top via `useSafeAreaInsets()`, not `justifyContent: 'center'` — the centering was the actual root cause of an entire afternoon's manual pixel-tuning, since a centered block's position depends on the height of whatever follows it (a 3-line subtitle vs. a timer+waveform), so two screens using it could never structurally guarantee the same title position
  - Verified end-to-end on simulator: both usages measured pixel-identical (screenshot rows 1052–1116 in both) after one shared constant, vs. two independently-tuned constants before
- **Fixed notes getting visually covered near the bottom of the book screen** — two compounding bugs, both found via the user driving the on-device element inspector directly (see Not vibe), not from screenshots alone:
  - `Animated.ScrollView` had no `style` prop (only `contentContainerStyle`), so it sized to its own content instead of filling the remaining space in `content` — fixed with an explicit `flex: 1` style
  - `BookScreen`'s `SafeAreaView` still reserved the bottom safe-area inset (34pt) for `content`, while the (hoisted, global) FAB sits at `bottom: 30` from the *true* screen edge, ignoring that inset — the two boundaries nearly coincided by coincidence, reading as one deliberate gap. Fixed by adding `edges={['top', 'left', 'right']}` to that `SafeAreaView` so `content` also extends to the true edge, consistent with how the FAB already behaves
  - Confirmed with a temporary bright-red `backgroundColor` probe on `content`, screenshotted before and after — before: stopped exactly 34pt short of the true bottom edge; after: reaches the true last pixel row

### Decisions made
- FAB and RecordingOverlay live above the navigator, not inside screens — trades a bit of indirection (screens register config instead of rendering directly) for eliminating an entire class of "the two screens don't match" bugs by construction
- `CentralInfoDisplay` positions itself via a fixed safe-area-relative offset, not centering — deliberately gives up "auto-centers regardless of content" for "identical position everywhere, always"
- Kept `BookScreen`'s "Amend"/"Wrong book?" capture triggers local to the screen (they need session-specific context) — only the FAB's resulting visual state/control and the overlay were hoisted, not the capture-starting logic itself
- `content`/`ScrollView` on the book screen now deliberately ignore the bottom safe-area inset, matching the FAB's own true-edge positioning, rather than the other way around — consistency with the FAB won over strict safe-area compliance

### Next session
- Real-device sanity check of the empty state and recording overlay's dynamic-type behavior (only verified on iOS Simulator this session)
- `book-header-collapse-fix` branch still needs its own PR merged to `main`

### Not vibe
- Sent the DOET reference itself ("take an example from *The Design of Everyday Things* — the chapter connecting Conceptual Model and Storytelling") that reframed the empty-state subtitle from an instruction into a demonstrated example — Claude had to look up which chapter, but the framing was the user's
- Caught Claude's FAB-position diagnosis being backwards: after Claude "fixed" the home screen to match the book screen's (higher) position, called it out directly ("look, how the FAB button is much higher...") which prompted a re-measurement that found the book screen was the regression, not the home screen
- Proposed the entire FAB/RecordingOverlay hoisting refactor unprompted, with the correct technical reasoning already in hand ("it floats above all, and is not part of the animation from home screen to book screen") — Claude had spent the session tuning per-screen constants to work around exactly the problem this solves structurally
- Extended that same insight to `CentralInfoDisplay` and specified the actual mechanism ("position absolute vertically against the screen") — correctly identifying that centering (not just duplication) was the root cause of the alignment drift
- Pushed back on Claude's "a few hours" implementation estimate ("a few hours?"), which was calibrated as if for a human dev's timeline rather than Claude's own — correctly caught as an unexamined default rather than a real estimate
- Multiple precise, falsifiable design corrections rather than vague feedback — "the divider too subtle, increase it," then "back to height 1, but keep the new color" (isolating exactly which of two changes to keep); "recording screen still has the lower divider" (specific enough to reveal the `gap`+negative-margin fix hadn't actually worked, prompting the switch to explicit margins)
- Asked to enable the RN element inspector directly rather than keep waiting on Claude's screenshot guessing — then used it themselves and reported the exact finding ("ScrollView is shorter than SceneView"), which is what actually located the bug Claude's own scroll screenshots had failed to reproduce
- Rejected Claude's first "is this actually fixed?" theorizing with a precise correction: "it is not in scrolling all the way up that you see something — you need the text to be near the bottom of the screen" — redirected from a wrong repro (max-scroll position) to the right one (any mid-scroll moment)
- Supplied the key diagnostic observation directly: "it is as if the bottom of the FAB is also the bottom of the scroll view" — this, not Claude's own reasoning, was what identified that the safe-area inset (34pt) and the FAB's offset (30pt) were two independent values that happened to nearly coincide
- Held the line after Claude's red-probe test showed the gap exactly matched the safe-area inset and Claude concluded that meant "working as intended" — insisted the gap itself was the problem regardless of why it existed, which was the correct call (the fix was to make `content` match the FAB's true-edge positioning, not to leave a technically-correct-but-inconsistent inset)

## Session 16 — 2026-09-04

### What we did
- **Announcement blog post** — `blog-post-plan.md` (outline) and `blog-post-draft.md` (full draft), iterated headline/tagline/opening paragraph over many rounds
  - Headline: "Capture your reading sparks." + subhead covering both quote and thought capture
  - Opening paragraph grounded in real lived experience (flying thoughts, notebook awkward mid-commute, hard to retrieve later, unsatisfying to reread) rather than a generic invented story
  - 4-step "How it works" walkthrough + a "Bonus" step showing the export → AI chatbot → published review workflow, linking the real Substack post on *Calm Parents, Happy Kids*
  - Reviewed that Substack post directly: the personal parenting anecdote and the "fear vs. love" throughline read as genuine (came straight from captured notes); the "Key Takeaways" bullets and closing line read as generic AI-chatbot boilerplate
- **TestFlight / App Store Connect**
  - Wrote the Beta App Description — verified against actual code (`useRecording.ts`) that voice recordings persist locally rather than being deleted after transcription, so the description doesn't misstate data handling to Apple's reviewer
  - Clarified App Store Connect dashboard links vs. the public `testflight.apple.com/join/...` link — the one pasted was a private dashboard URL, not shareable
  - Found the actual public TestFlight link resolves but says "not accepting new testers" — likely Beta App Review still pending for the external testing group
  - Wrote "What to Test," revised from an initial per-PR/changelog framing to a holistic first-time-tester framing after feedback that external testers have no prior build to diff against
  - Picked "Beta Readers" as the external testing group name (double meaning: literal beta testers + real publishing-world term)
- **Merged PR #18** (crash fix, previously unmerged) into `main`. Also uncovered and corrected a mistake: an initial `eas build:list` check used `tail -100`, which truncated the output and hid the most recent entries — this produced an incorrect claim that the crash fix hadn't shipped yet, and a redundant new build got started. Re-checking via `submit:list` (untruncated) showed the Aug 15 submission (commit `bdf6484`) already included the fix; the redundant build was not submitted.
- **BookScreen collapsing header** (branch `bookscreen-collapsing-header`, not yet merged) — the big cover/title/metadata block now shrinks and fades as the session list scrolls, crossfading into a compact cover-thumbnail + title/author that merges into the fixed back/menu nav row, instead of the old behavior where the whole header just scrolled out of view
  - Implemented with React Native's `Animated` API (scroll-tracked interpolation on height/opacity), no new dependencies
- **Dev tooling**: `npm run seed` (`scripts/seed_dev_db.py`) seeds the simulator's local SQLite DB for fast UI iteration without hand-recording notes
  - First pass used hand-typed synthetic data via a bash/sqlite3 heredoc — replaced after review: fabricated content was too thin, and hand-escaping real text (apostrophes, em-dashes) into SQL string literals is fragile
  - Reworked around `scripts/seed-data/*.json` — real book exports in the exact shape the app's own Export feature produces (`BookBackup` in `bookBackup.ts`), so any future real export can just be dropped in and reseeded automatically. Seeded with a real 10-session export ("The Design of Everyday Things") plus a small synthetic "Deep Work" (2 sessions, one deliberately null-note to preview the crash-fix fallback UI on demand)
  - Rewrote the seeding logic itself in Python using parameterized `sqlite3` queries instead of shell string-building — avoids hand-escaping entirely, verified round-tripping real text with quotes/apostrophes/em-dashes correctly against a throwaway test database before wiring it to the actual simulator path

### Decisions made
- Blog post scope: ship the simple announcement now (walkthrough + screenshots + TestFlight CTA); defer the deeper "how it's built" / engineering-war-story post (note-corruption crash) to a separate follow-up once there's real testing behind it
- Export-to-AI-chatbot-review kept as an un-numbered "Bonus," not step 5 of the core loop — it's occasional/advanced, not something that happens every use
- BookScreen header collapses into one merged nav row (title crossfades into the back/menu row) rather than two stacked rows — matches Apple Music/Spotify/iOS-native large-title-collapse convention, and reclaims vertical space

### Next session
- Test the collapsing header on device/simulator (seed data first via `npm run seed`), open a PR once verified
- Check Beta App Review status in App Store Connect for the external testing group — the public link isn't live yet
- Fill remaining blog draft placeholders: TestFlight link (once public link works) and 4 screenshots
- `blog-post-plan.md`/`blog-post-draft.md` are still untracked locally, not committed anywhere — decide if/where they should live in git

### Not vibe
- Caught two real phrasing inaccuracies in the blog draft Claude missed: "finish reading" implied finishing the whole book, not a session; "put the book down" excluded capturing quotes with the book still open
- Rejected Claude's generic "I used to type into my phone" origin story outright and supplied the real, specific version instead (flying thoughts, notebook mid-commute, hard-to-retrieve pages, unsatisfying to reread) — genuinely truer and better content than what was drafted
- Pushed back twice on Claude's claim that the crash fix hadn't shipped yet ("I think my latest build already has this" / "I think my prev submit already includes the crash fix") — Claude's first check was wrong due to a truncated command output; the user's own memory of what had actually been built was correct, and that persistence is what caught the error before an unnecessary duplicate build went out
- Asked "what do other apps usually do?" before accepting Claude's first suggestion (two stacked header rows) — that question directly produced the better, more idiomatic answer (one merged row), reversing Claude's own initial default
- Requested "What to Test" be reframed around a first-time external tester's actual experience, not a per-build changelog Claude had drafted by default
- Rejected Claude's first seed-data attempt as "not good enough" and supplied a real 10-session export instead of letting fabricated placeholder content stand in for actual usage — directly led to redesigning the seed script around real export files rather than hand-typed data

### Retrospective — the collapsing-header debugging session

The BookScreen collapsing-header UI work (branch `bookscreen-collapsing-header`, PR #19) became the longest, most frustrating stretch of this session by far. Worth recording honestly rather than glossing over, since the goal is to actually do better next time, not just to move on.

**How bad it was.** Roughly 35-40 messages and ~13 screenshots went into this specific piece of work. Not 13 rounds of the same bug — 13 *distinct* bugs, each with a genuinely different root cause: absolute positioning ignoring an ancestor's padding (twice — once for `headerRow`'s own padding, once for the safe-area inset), sibling paint order not following `position: absolute`, an opaque background living on the wrong non-animated layer, two independently-sized elements leaving a coverage gap for scrolled content to show through, a height inferred via `bottom: 0` silently drifting from an animated parent, padding surviving an animated `height: 0`, a shared `divider` style with conflicting needs in two different visual states, and nav buttons centered in a height that was itself changing. At least 4 times something was stated as fixed with more confidence than had actually been earned, and it wasn't.

**Why it was this hard.** The root cause underneath all of it: debugging a visual, animated layout with no direct feedback loop. A human doing this taps save, glances at the simulator, sees it's wrong, adjusts — seconds. The actual loop here was: write code → user screenshots → user sends it → Claude interprets a static image (sometimes wrongly — cropping, compression, and scale ambiguity cost several rounds on their own) → hypothesize → write more code → repeat. A static screenshot also can't show a *transition* — the whole point of the feature — so correctness was being inferred from single frames of an animation, which is inherently lossy. On top of that, several of the bugs were genuine React Native/Yoga footguns (not sloppy code) — individually-documented features whose *combination* produces surprising behavior that isn't spelled out anywhere. Not being able to inspect the actual computed layout tree (the way Xcode's view debugger or Flipper would let a human do directly) meant deducing from symptoms instead of measuring, which is slower and wrong often enough to matter. Fixes also compounded: fixing the paint-order bug (scrolled cards showing through the header) by adding an opaque background *introduced* a new bug (that background covering the chevron and hero title at rest), because it went on the wrong layer — something that would have been caught in one glance with direct visual access.

**Why screenshots specifically got misread.** Claude's "vision" of an image is closer to a holistic description pass than pixel-ruler measurement — reliable for gross features (is the cover there, is something overlapping), unreliable for fine proportional judgments ("is bottom padding bigger than top padding") where the two things being compared are far apart in the frame and there's no ruler. When Python/PIL scripts were used to actually measure precisely, that helped — but produced real sampling errors along the way (a measurement column landing on text or a decorative phone-bezel graphic instead of the real background, then treating that bad reading as ground truth). Worse than the tooling slip: at least a few times, a theory already formed from reading the *code* ("alignItems:center should give symmetric padding") colored how a screenshot got described back, instead of treating the image as ground truth and re-deriving fresh each time. That's confirmation bias, and it's the more damning failure of the two.

**How much of this is UI-specific vs. a general AI limitation.** Roughly a third of the pain is genuinely UI-specific: the cost of the verification loop, since Claude can't self-check a visual render the way it can run a test and see pass/fail. The largest share, though, is general to any complex system with under-documented emergent interactions between individually-simple pieces — concurrency, distributed systems, and security all have this same character (individually well-understood mechanisms, surprising joint behavior). UI just combines unusually dense interacting subsystems (layout engine, animation driver, native rendering, touch handling) with an unusually expensive verification loop, so the same underlying reasoning weakness gets maximally exposed and maximally costly here specifically. The smallest share, but the most damning, is a general AI epistemic weakness independent of domain entirely: overconfidence, and reading evidence through the lens of a prior theory instead of fresh. That failure mode would show up in any domain — it's just invisible in cheap-to-verify work, because Claude catches it before it ever reaches the user.

**What would help next time.** Reach for visual debug instrumentation (colored backgrounds marking component boundaries) after one failed round, not the fourth or fifth. Always ask for full, uncropped, unedited simulator screenshots — several rounds here were actively misled by cropped or heavily-compressed images. Precise, explicit comparisons ("the gap between blue and the start of the non-scrollable area") converge far faster than "not good enough." Name shared-resource tension early — a style used in two different visual states with different needs is a recurring trap. And for animated/layout work specifically, treat the first pass as a spec-and-risk conversation — naming the known framework gotchas before writing code — rather than only surfacing them reactively after each one causes a visible bug.

---

## Session 15 — 2026-08-15

### What we did
- **Fixed note-corruption crash** — a book became permanently unopenable after recording a long (~3min), quote-heavy second session
  - Root cause: `extractNoteOnly` (used when adding a session to an already-open book) capped `max_tokens: 512`, tighter than its siblings (1024) with no real justification. A long transcript could truncate Claude's structured JSON response mid-generation.
  - `getSessionsByBookId` (`database.ts`) did unguarded `JSON.parse(row.note)` inside a `.map()` — one corrupted row threw and took down the entire book's session list, every time that book was opened, while other books loaded fine.
- **`extract.ts` rewrite** — shared `callClaudeTool`/`callClaudeToolWithRetry` helper used by all three extraction functions (`extractNoteOnly`, `extractBookInfo`, `amendNote`):
  - `max_tokens` now sized dynamically from input length (`clamp(inputTokens * 1.4 + 300, 512, 4096)`) instead of a flat guess
  - Explicitly checks `stop_reason === 'max_tokens'` — a truncated response is never trusted even if structurally valid, since it may be missing content that didn't fit
  - One retry at a fixed generous budget (4096) if the first attempt truncates; still-truncated after retry throws `ExtractError` rather than persisting incomplete data
  - `assertBlocks()` validates the response actually contains a `blocks` array before returning — guards against `JSON.stringify(undefined)` (`"undefined"`, invalid JSON) ever reaching the database
- **Crash-safe fallback instead of data loss** — `note` is now `NoteBlock[] | null` throughout (`database.ts`, `bookBackup.ts`)
  - `getSessionsByBookId` catches parse failures (or non-array JSON) and returns `note: null` for that session instead of throwing — unblocks the whole book immediately, including your already-corrupted row
  - `useRecording.ts`'s pinned-book path catches extraction failure and saves the session with `blocks: null` (raw transcript untouched) instead of losing the recording or corrupting the column
  - `BookScreen.tsx`: sessions with `note === null` render a "Processing failed — showing raw transcript" fallback (plain `raw_transcript` text) instead of `NoteBlocksRenderer`, with a **Re-process** action (re-runs `extractNoteOnly` on the stored transcript, calls `updateSessionNote` on success) replacing Amend for that session
  - Added 5 new tests locking in the fix: truncation retry, still-truncated-after-retry throws, missing-blocks validation, and the pinned-book extraction-failure fallback

### Decisions made
- Dynamic `max_tokens` sizing (not a flat large constant) — a fixed high ceiling removes the cheap circuit-breaker against degenerate/looping generation; sizing from input keeps short notes cheap and fast while still covering long ones
- No hard cap on recording length — would cut against the app's zero-friction principle; better to let the backend absorb variability
- Graceful fallback (raw transcript + manual re-process) scoped to the pinned-book path only, matching the actual bug and the UI built for it — `extractBookInfo`'s new-book path already had this class of robustness improved (dynamic sizing/retry) but total-failure-after-retry there still surfaces as a lost recording via the existing top-level error alert, same as before this fix
- Adopted a strict linear-branch workflow going forward (chain, not star) — always branch fresh off up-to-date `main`, merge before starting the next branch, since solo work has no reason to keep parallel long-lived branches open

### Next session
- Deploy to phone via EAS build/submit, confirm the previously-crashing book opens and Re-process recovers it
- Consider extending the same graceful-fallback treatment to the new-book (`extractBookInfo`) path if total extraction failure there proves to be a real annoyance in practice

### Not vibe
- Rejected the first fix Claude proposed (flat retry-with-bigger-budget-on-truncation) and asked why `max_tokens` isn't just sized off the actual transcript length instead — this became the primary mechanism (dynamic sizing), with retry demoted to a secondary safety net for when the estimate undershoots. Better design than what was initially proposed.
- Pushed on "what's the downside of setting max_tokens extremely high" before accepting any fix — forced the actual tradeoff (removes a cheap circuit-breaker against runaway/degenerate generation) to be articulated rather than just taking "raise the limit" at face value.
- Specified the recovery UX directly: "processing failed, so this is raw transcript" + a re-process button — a concrete product decision for how a degraded state should look and behave, not something Claude initiated.
- Set the branching policy (linear chain, not star, merge before starting next) as explicit engineering process for solo work, and separately asked whether true stacked-PRs (base on an unmerged branch) were possible before deciding the simpler discipline was the better fit here.

---

## Session 14 — 2026-08-05

### What we did
- **Apple Developer Program enrollment** — paid individual membership ($99/yr), unblocks year-long dev signing and TestFlight distribution (was previously hitting 7-day free-signing resigns on daily-driver phone)
- **EAS Build/Submit setup** — no `eas.json` existed before; added `development`/`preview`/`production` build profiles
  - `app.config.js`: added `extra.eas.projectId` (dynamic config required manual edit — `eas init` can't write to `.js` configs)
  - Fixed cloud build failure: `SENTRY_DISABLE_AUTO_UPLOAD` was only in local `.env` (gitignored, invisible to EAS's cloud builder) — added to each `eas.json` build profile's `env`
  - Moved `EXPO_PUBLIC_OPENAI_API_KEY` / `EXPO_PUBLIC_ANTHROPIC_API_KEY` / `EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY` / `EXPO_PUBLIC_SENTRY_DSN` to EAS encrypted environment variables (`eas env:create`) — same `.env`-not-reaching-cloud-builder issue, and these are secrets so they don't belong in the committed `eas.json`
  - Added missing `ios.infoPlist.NSMicrophoneUsageDescription` to `app.config.js` — required by App Store review, was previously unset
  - First production build + submit succeeded; app now live in App Store Connect; TestFlight internal testing configured (export compliance answered, self added as internal tester)
- **Rename: BookBuddy → Syntopico** — "BookBuddy" was already taken on the App Store
  - New logo (serif "S" + accent-blue dot, same palette) rasterized into `icon.png`, `splash-icon.png`, `android-icon-foreground.png`, `favicon.png` via `rsvg-convert` (installed, wasn't present locally)
  - Renamed in `app.config.js` (display name, slug, mic permission string), `package.json`, `tokens.ts` comment, in-app title (`VoiceCaptureScreen.tsx`), `CLAUDE.md`, `flows.md`
  - Bundle identifier switched `com.nnc.bookbuddy` → `com.nnc.syntopico` (see decisions)
- **Custom Syntopico wordmark** — new `src/components/Wordmark.tsx`: "Synt" + an accent-blue circle standing in for the middle "o" + "pico", set in Bellefair (`@expo-google-fonts/bellefair`, newly installed), single charcoal (`BODY`) color — replaced the old two-tone "Book"/"buddy" Newsreader treatment on both `HomeScreen` and the unreachable `VoiceCaptureScreen`. Dot size/position tuned by eye across several rounds on device.
- **Fixed splash screen color seam** — `splash.backgroundColor` was pure white (`#ffffff`) while `splash-icon.png` has the `SURFACE` cream (`#FCFAF4`) baked into its background, producing a visible square seam on launch since `resizeMode: 'contain'` doesn't crop to fill. Matched the two colors.
- **First successful EAS build + submit** to the new `com.nnc.syntopico` App Store Connect record
  - Non-interactive `eas submit` failed without a saved `ascAppId` — added it to `eas.json`'s submit profile
  - Added `ITSAppUsesNonExemptEncryption: false` so App Store Connect stops asking the Export Compliance question manually on every future submission
  - Hit and fixed an EAS slug mismatch: `extra.eas.projectId` was registered under slug `bookbuddy` on expo.dev; reverted the local `slug` back to match rather than renaming the remote project
- **Repo cleanup** — GitHub repo renamed `bookbuddy` → `syntopico` (auto-redirects), removed the stale unused `app.json` (superseded by `app.config.js`, had drifted out of sync), synced `package-lock.json`'s root name
- **Merged the star-shaped PRs** — noticed PR #16 (direct-record triggers) and PR #17 (rename/EAS/wordmark) had both forked from the same old `main` commit, and that features already built — the direct Amend/Wrong-Book triggers, the blue-dot mic indicators — weren't actually live in the app despite being "done." Merged #16 first, then rebased #17 onto updated `main`, resolving conflicts in `build-log.md` (chronological reorder) and `HomeScreen.tsx` (merged cleanly — both feature sets coexist correctly, verified by typecheck + full test suite)

### Decisions made
- Bundle identifier: chose to switch to `com.nnc.syntopico` rather than keep `com.nnc.bookbuddy` — fully consistent branding, accepted the cost (new Apple App ID, new App Store Connect app record, redo TestFlight setup, local data doesn't carry over automatically)
- SQLite filename (`bookbuddy.db`) left unchanged — purely internal, invisible to users, no reason to risk a data reset for a cosmetic rename
- `android-icon-background.png`/`android-icon-monochrome.png` left as Expo's unmodified scaffold defaults — never customized even under the BookBuddy brand, out of scope here
- Stale unused `app.json` (superseded by `app.config.js`, config drifted out of sync) left in place, flagged for a future cleanup pass
- TestFlight builds expire 90 days after processing — separate, much less painful cadence than the old 7-day free-signing cycle; full App Store release is the only way to remove renewal entirely
- EAS project slug stays `bookbuddy` (doesn't match the app's `syntopico` display name) — it's an internal expo.dev identifier only, renaming the remote project isn't worth the hassle for something invisible to users

### Next session
- Export each book via `bookBackup.ts`'s `exportBook` from the old `com.nnc.bookbuddy` install, re-import into the new app after install
- Daily-use the renamed app on device — this is what surfaced the note-corruption crash fixed in Session 15

### Not vibe
- Chose to switch the bundle identifier to `com.nnc.syntopico` over Claude's recommendation to keep `com.nnc.bookbuddy` — consciously accepted the real cost (new Apple App ID, fresh App Store Connect record, redo TestFlight setup, no automatic data carryover) for full branding consistency.
- Specified the wordmark redesign precisely and unprompted — Bellefair, not Newsreader; single charcoal text color; the middle "o" replaced by a blue dot matching the logo mark — then iterated the exact size/position values by eye across several rounds rather than accepting the first guess.
- Caught the splash-screen color seam through actual use ("I see a square background... is it possible or am I imagining things?") — real dogfooding, not something Claude flagged first.
- Noticed PR #16 and #17 had forked from the same old commit and that features already "done" (direct Amend trigger, blue-dot indicators) weren't actually live in the app — caught a real gap between merged-in-theory and shipped-in-practice, not just trusting that open PRs meant the work was delivered.

---

## Session 13 — 2026-07-11

### What we did
- **Replace modal voice prompts with direct-record triggers**
  - Amend and "Wrong book?" now start recording immediately on tap — no more intermediate `UnifiedPrompt` modal screen
  - New `useVoiceCapture` hook: shared recording flow for secondary voice actions (amend, wrong-book), used by `BookScreen`/`HomeScreen`
  - `RecordingOverlay` label adapts per scenario: "Amend a reading note", "What book was that?", "Record your new reading note"
  - `UnifiedPrompt.tsx` deleted entirely
  - Retry logic removed from `useRecording`: unidentified notes with no library match are now silently dropped instead of prompting retry
  - Blue dot indicator added to Amend and Wrong Book buttons to signal they trigger the mic directly
- **Keep screen awake during recording/transcription**
  - `expo-keep-awake` activated when recording starts, deactivated on completion or error
  - Covers all three recording paths: new note, amend, wrong-book

### Decisions made
- Modal confirmation step before recording adds friction without value — direct-record trigger matches "zero friction on input" principle
- Retry-on-unidentified-book dropped in favor of silent drop when no library exists yet to disambiguate against

### Next session
- Test end-to-end on device (direct-record triggers, overlay labels, keep-awake across all 3 paths)

---

## Session 12 — 2026-06-27

### What we did
- **Amend note feature** (PR #15) — replaces Re-record entirely
  - `amendNote(existingBlocks, transcript, bookTitle, bookAuthor)` in `extract.ts`: sends existing note + spoken amendment to Claude, returns updated `NoteBlock[]`. Handles corrections, additions, and targeted edits in one call.
  - `updateSessionNote(sessionId, blocks)` in `database.ts`: `UPDATE reading_sessions SET note = ?`
  - `BookScreen`: `rerecordRef` + `handleRerecord` removed. New `amendSessionId` state shows UnifiedPrompt ("What would you like to change?"). Action row: "Wrong book?" | "Amend" · "Delete"
- **Claude prompt improvements** (also in PR #15)
  - Natural first-person framing: "I just finished a reading session, and here's my note"
  - Blocks description: semantic definition of quote vs thought; implicit citation signals; paraphrase rule explicit
  - `extractNoteOnly` and `amendNote` now receive `bookTitle` + `bookAuthor` for disambiguation

### Decisions made
- Re-record dropped: equivalent to delete + new recording, no added value
- 2-round Claude approach rejected: latency cost outweighs benefit
- Structured output (tool use) preferred over markup+TypeScript parsing

### Next session
- Merge PR #15 after device testing

---

## Session 11 — 2026-06-06

### What we did
- **T19: Visual redesign** (PR #13)
  - Installed `expo-blur` + `@expo-google-fonts/newsreader`
  - `src/tokens.ts` — single source of truth for all design tokens
  - `src/components/Fab.tsx` — icon-free navy disc, breathe+glow at rest, accent+pulse when recording, reduced-motion aware
  - `src/components/RecordingOverlay.tsx` — unified BlurView overlay: contextual label, 56px tabular timer, 5-bar waveform, processing spinner
  - `src/components/NoteBlocksRenderer.tsx` — accent blue border on quotes, Newsreader italic, uppercase location caption
  - `src/components/UnifiedPrompt.tsx` — navy-tinted BlurView, Newsreader heading, reuses Fab
  - `src/screens/HomeScreen.tsx` — serif/italic wordmark, redesigned book cards, accent dot on active row
  - `src/screens/BookScreen.tsx` — larger cover, chapter in Newsreader italic accent, highlight glow
  - `App.tsx` — loads 6 Newsreader font variants, returns null until ready

### Decisions made
- FAB is icon-free: breathe+glow invites the tap; color shift + overlay carry the "recording" meaning
- Clothbound placeholder covers deferred — `#C8BFAF` warm beige for now, sufficient for MVP
- pre-existing TS errors in VoiceCaptureScreen/identifyBook not touched (out of scope)

### Next session
- Build dev app, test T19 on device (fonts, FAB animation, overlay, all screens)
- Merge PR #13 if it looks good

---

## Session 10 — 2026-06-05

### What we did
- **Claude Design prompt for T19/T20** — drafted the full visual redesign brief
  - Finalized color palette from Bb logo: navy `#1B2A4A` (primary), light blue `#7BA7C9` (accent), white/off-white bg; red `#E53935` fully removed
  - Decided on 4 screens to mockup: Home (book shelf), Book (sessions + note cards), Recording overlay, Retry prompt ("Sorry, what book was that?")
  - Recording overlay: unified blur/dim experience across Home and Book screens — contextual label transitions recording → transcribing → identifying → saving
  - FAB without red: mic icon + pulse ring + overlay label + active color shift to accent blue together replace the red "record" convention
  - Find mode: deferred entirely — FAB stays pure record; Find will be a header search icon (voice-first) when built in a future phase
  - Timeline view: confirmed as Phase 2 — book shelf stays as home screen (better empty state, motivating collection feel)

### Decisions made
- Find mode has no UI presence yet — no toggle above FAB, no second button
- Book shelf (not timeline) stays as the home screen; timeline is a secondary view once there's enough data
- FAB color convention: rely on icon + motion + overlay, not color alone
- Claude Design prompt is ready to paste — user will submit it next session

### Next session
- Build dev app, test T19 on device (fonts, FAB animation, overlay, all screens)
- Merge PR #13 if it looks good

---

## Session 9 — 2026-05-29/30

### What we did
- **T12/T13: Re-record and delete note actions** (PR #12)
  - New `deleteSession(sessionId)` in `database.ts`
  - Expanded sessions now show three actions: **Wrong book?** (left) · **Re-record** · **Delete** (right)
  - Re-record: stores old session id in `rerecordRef`, calls `start()` immediately, deletes old session in `onComplete`
  - Delete: confirmation alert → `deleteSession` → reload
  - Both verified working on device
- **Production build**
  - Resolved provisioning profile error: built once from Xcode GUI to regenerate profile, then switched to terminal
  - `SENTRY_DISABLE_AUTO_UPLOAD=true` must be passed at shell level (not picked up from `.env` by Xcode)
  - Dev and production builds coexist on device (`com.nnc.bookbuddy.dev` vs `com.nnc.bookbuddy`)
  - Production build: `npx expo prebuild --platform ios --clean` then `SENTRY_DISABLE_AUTO_UPLOAD=true npx expo run:ios --configuration Release`
  - Profile trust required on device after each new bundle ID install

### Next session
- T19/T20: Claude Design briefs + visual redesign — last step before daily use

---

## Session 8 — 2026-05-27

### What we did
- **Refactor `useRecording.ts`** — separated abstraction layers per Ousterhout
  - Extracted module-level helpers: `saveAudioFile`, `findOrCreateBook`, `recordingErrorMessage`
  - Extracted named inner functions: `processTranscript` (4 cases as flat early-returns), `resolveWithRetry` (retry loop isolated)
  - `start()` reduced to 10 lines; `stop()` reads as 5 named steps
  - `resolved` flag variable and `!` assertions eliminated; console.log scaffolding removed
- **Fix Google Books cover selection** (PR #11)
  - Old logic picked purely by title similarity → non-deterministic when editions scored equally, could return old/obscure covers
  - New composite score: title similarity (primary) + thumbnail bonus (+0.15) + ratings count bonus (up to +0.1)
  - Popular canonical editions consistently preferred over old ones
  - `maxResults` bumped 5 → 8 for more candidates; extracted `pickBest()` + `itemScore()`
  - Motivated by "Thinking in Systems" repeatedly returning an old edition cover

### Decisions made
- Dropped T09 barcode scan — useless for Kindle (majority of use), friction for physical books
- Revised T09 to cover photo → Claude Vision only (simpler, works for Kindle screens)
- Dropped T11 multi-candidate picker — the real cover problem was edition selection, not ambiguous titles; fixed directly in `googleBooks.ts`
- Revised plan to MVP: fix covers → T12/T13 edit note → T19/T20 Claude Design → ship to self

### Next session
- T12: `updateSession` DB function
- T13: Edit note screen

---

## Session 7 — 2026-05-23

### What we did
- **T04/T05: NoteBlocksRenderer + BookScreen wiring**
  - New `src/components/NoteBlocksRenderer.tsx`: thought blocks as plain text, quote blocks with red left-border accent + italic text + location caption
  - `collapsed` prop for list rows renders a flat 2-line preview
  - `BookScreen.tsx`: replaced `flattenBlocks()` with `NoteBlocksRenderer`; confirmed quote layout working on device
- **T07: UnifiedPrompt component** — new `src/components/UnifiedPrompt.tsx`
  - Full-screen modal overlay with message, tap-to-listen mic button, optional secondary action + cancel
  - Handles its own recording + transcription (expo-audio + Whisper); calls `onTranscript(text)` when done
- **T08: No-book retry flow** — replaces the Alert crash in `useRecording`
  - When null title + no books: hook suspends via Promise (`awaitRetry`), exposes `retryPrompt` state and `provideRetryTranscript` to the screen
  - HomeScreen renders UnifiedPrompt when `retryPrompt !== null`; dismissing calls `provideRetryTranscript(null)` → note silently discarded
  - Up to 2 spoken attempts ("Sorry, what book was that?" → "I still couldn't identify it. Try again?") before discarding
  - "Take a photo instead" deferred to T09
- **T06: "Wrong book?" button** — in BookScreen expanded session view
  - `wrongBookSessionId` state + UnifiedPrompt rendered when set
  - On transcript: `extractBookInfo` → find/create correct book → `reassignSession` → navigate to new book (or reload if same)
  - New DB function `reassignSession(sessionId, newBookId)`
- Tests: updated 2 tests to match T08 behavior (no Alert → retryPrompt pattern); added retryPrompt assertion

### Next session
- T09: PhotoFallback — camera + barcode scan + Claude Vision for book identification; wire "Take a photo instead" into T08
- Or T12/T13: edit note screen (independent, lower risk)

---

## Session 6 — 2026-05-19

### What we did
- **T03: Quote extraction in Claude prompt** — `extract.ts` now returns `NoteBlock[]` instead of a flat string
  - `ExtractedNote.note: string` → `ExtractedNote.blocks: NoteBlock[]`
  - `extractNoteOnly` return type: `{ chapter, note }` → `{ chapter, blocks }`
  - Both Claude tool schemas updated: `note` field replaced by `blocks: NoteBlock[]` array
  - Prompt instructs Claude to detect "quote ... end quote" / "open quote ... close quote" → `{ type: 'quote' }` blocks; everything else → `{ type: 'thought' }` block
  - `database.ts` `insertReadingSession`: removed the manual `[{ type: 'thought', text: extracted.note }]` wrap — now uses `extracted.blocks` directly
  - `useRecording.ts`: destructures `blocks` instead of `note` for both pinned and unpinned paths
  - Tests: updated mocks + assertions; added new quote block test case (5 → 9 in extract.test.ts)
  - Also fixed `useRecording.test.ts` pre-existing breakages from SDK 55 migration: `expo-av` → `expo-audio` mock, `getBooks` → `getBooksByLastSession`, `note` → `blocks` in all mocks
  - All 12 tests pass

### Next session
- T04: `NoteBlocksRenderer` component — replace `flattenBlocks()` in `BookScreen.tsx` with a proper per-block renderer

---

## Session 5 — 2026-05-10 / 2026-05-18

### What we did
- **T02: Note blocks data model** (PR #5)
  - New `src/types/note.ts`: `NoteBlock` union type (`thought | quote`) + `flattenBlocks()` helper
  - `database.ts`: notes now stored as JSON `NoteBlock[]` in the existing `note` column; `getSessionsByBookId` deserializes on read
  - `bookBackup.ts`: export/import format bumped to `version: 2` with `NoteBlock[]` notes
  - `BookScreen.tsx`: uses `flattenBlocks()` until a proper block renderer lands in T04
  - Dropped backward compat after review — fresh app, no migration needed
- **SDK 55 upgrade** (PR #6) — forced by Xcode auto-updating to 26.5
  - Expo SDK 54 native builds are broken on Xcode 26 (fmt library `consteval` errors, SwiftUICore linker errors)
  - Bumped all `expo-*` to `~55.0.0`, `react-native` to `0.83.6`, `@sentry/react-native` to `^8.x`
  - Replaced `expo-av` with `expo-audio`: recording API migrated to `useAudioRecorder` hook
  - Added `expo-audio` to config plugins (provides `NSMicrophoneUsageDescription`) — missing this caused permission call to hang silently
  - Enabled New Architecture (`experiments.newArchEnabled: true`) — required by `expo-audio`
  - Added `SENTRY_DISABLE_AUTO_UPLOAD=true` to avoid sentry-cli org error on every build

### Learnings / gotchas

**Xcode auto-updates break native builds**
Xcode updated itself to 26.5 (iOS 26 SDK). Expo SDK 54 pods were not compatible — multiple native compile failures. Solution: upgrade Expo SDK, not downgrade Xcode.

**expo-audio plugin is required for microphone permissions**
When migrating from `expo-av` to `expo-audio`, the `expo-audio` config plugin must be added to `app.config.js`. Without it, `NSMicrophoneUsageDescription` is missing from Info.plist and `requestRecordingPermissionsAsync()` hangs silently on iOS — no dialog, no error.

**New Architecture required for expo-audio**
`expo-audio` uses `useReleasingSharedObject` from expo-modules-core which requires New Architecture. Disabling it (`newArchEnabled: false`) caused the record button to freeze.

### Next session
- Merge PRs #5 and #6
- T03: Update Claude extraction to return `NoteBlock[]` instead of flat string
- T04: `NoteBlocksRenderer` component

---

## Session 4 — 2026-05-09

### What we did
- Reviewed `tasks.md` and began implementing tasks as stacked PRs
- Installed `gh` CLI via Homebrew for automated PR creation
- **T00: Sentry** (PR #1, merged)
  - `Sentry.init()` in `App.tsx`, enabled only in non-dev builds
  - Added breadcrumbs in `useRecording`: `no_book_identified`, `book_matched`, `book_created`, `recording_completed`, `recording_failed` (with error type)
- **T01: Unit tests** (PR #2, merged)
  - `src/services/__tests__/extract.test.ts` — 6 tests covering `extractBookInfo` and `extractNoteOnly`, mocking `global.fetch`
  - `src/hooks/__tests__/useRecording.test.ts` — 3 tests for last-book fallback, pinned book, and new book flows
  - `jest.setup.ts` for env var stubs
- **flows.md** (PR #3, merged) — authoritative reference for all supported user flows
- **Rename `getBooks` → `getBooksByLastSession`** (PR #4, merged)
  - Went through `getBooksByLastActivity` first (user flagged as too vague)
  - Final name `getBooksByLastSession` — matches `reading_sessions` table and communicates sort order precisely
  - Discussed Philosophy of Software Design: names should communicate behavior, not just identity

### Learnings / gotchas

**Stacked PRs and rebase conflicts**
T01 merged before T00 into main, causing a rebase conflict in `useRecording.ts`. Resolved manually: kept both Sentry breadcrumbs and the renamed function.

**GitHub shows all commits from stacked branches**
When viewing a stacked PR on GitHub, all commits from lower branches appear in the diff. This is cosmetic — only the diff from the base branch matters.

### Next session
- Implement T02: note blocks data model

---

## Session 3 — 2026-05-04

### What we did
- Pushed all code to GitHub (nhatcuong/bookbuddy), set up SSH key
- Set up dev/release build split: `app.config.js` with `APP_VARIANT` env — `com.nnc.bookbuddy.dev` (dev client + Metro) and `com.nnc.bookbuddy` (Release, standalone)
- Installed `expo-dev-client`, resolved `@types/react` peer dep conflict
- Fixed Google Books 503 — retry logic (3x, 2s delay) for 503 + 429
- Installed app on phone via Xcode — Release build is standalone, dev build connects to Metro
- Brainstorming session — designed and saved to memory:
  - Photo fallback for book identification (barcode scan + Claude Vision, one button)
  - Unified prompt interface for "Sorry, what book was that?" retry flow (max 3 attempts, honest drop)
  - Edit note — text box + optional mic dictation, no AI parsing
  - Multi-candidate picker with "None of these → take a photo"
  - Record vs Find — two voice modes, mode toggle above FAB
  - Find — SQLite FTS first, RAG deferred
  - Quote capture — "quote... end quote" → NoteBlock type, page/location metadata
  - Recap/export — MD file + share sheet + pre-filled AI prompt
  - Claude Design — plan to mockup key screens after logic done, UX must make Record/Find unmistakable
  - Sentry — crash reporting + usage counters (T00)
- Wrote `tasks.md` (21 tasks, T00–T20, 7 groups) and `open_questions.md` (10 open questions)

### Next session
- Review `tasks.md`, adjust scope/sequencing
- Implement each task as a separate stacked PR
- Session after: review PRs, merge when happy

---

## Session 2 — 2026-03-18

### What we did
- Built `src/screens/VoiceCaptureScreen.tsx`
  - Record button using `expo-av` `Audio.Recording`
  - Pulse animation ring during recording
  - Live duration counter (mm:ss)
  - On stop: moves file to `documentDirectory/recordings/<timestamp>.m4a`
  - Spinner while transcribing, transcript displayed below button after done
- Built `src/services/whisper.ts` — POSTs audio to OpenAI Whisper API, returns transcript string
- Wired `VoiceCaptureScreen` into `App.tsx`
- Added `.env` for `EXPO_PUBLIC_OPENAI_API_KEY` (gitignored)

### Learnings / gotchas

**expo-file-system legacy API**
In SDK 54, `makeDirectoryAsync` / `moveAsync` moved to `expo-file-system/legacy`. The new API uses `Directory` and `File` classes imported from `expo-file-system` directly. Use `new Directory(Paths.document, 'subdir')` — passing a bare relative path resolves to the system root and throws a permission error.

**Env vars need a server restart**
`EXPO_PUBLIC_*` vars are baked in at bundle time. Changing `.env` requires restarting `node node_modules/expo/bin/cli start`, not just saving and reloading.

### Next session: Step 5 — Book entity extraction
- Send transcript to Claude API (structured output)
- Extract: book title, author (if mentioned), chapter, note
- Display extracted fields for user confirmation
- Handle ambiguous / unrecognized titles

---

## Session 1 — 2026-03-18

### What we did
- Decided on the project concept and phases (see CLAUDE.md)
- Scaffolded an Expo + TypeScript project
- Got the app running on a physical iPhone 15 Plus via Expo Go
- Created the SQLite database schema (books + reading_sessions tables)
- App renders on device with DB initializing on startup

### Learnings / gotchas for future reference

**Expo SDK version hell**
The biggest time sink. `create-expo-app` scaffolds for the latest SDK (55 at the time), but Expo Go on the App Store ships with SDK 54. These must match exactly.
- Always check Expo Go's SDK version first: it tells you on the error screen
- Then set `expo: ~54.0.0` (or whatever matches) and let the local CLI resolve everything else
- Use `node node_modules/expo/bin/cli install <package>` — not `npx expo install` — to get SDK-compatible versions automatically

**React Native version must match the SDK**
Manually pinning `react-native: 0.76.7` caused a `PlatformConstants not found` TurboModule crash.
The fix: check `node_modules/expo/package.json` for the bundled `react-native` version and match it exactly.
For SDK 54: React 19.1.0 + React Native 0.81.5.

**npx expo is broken on Node v25**
`npx expo` fails with `Cannot find module '@expo/cli'` on Node 25.
Workaround: use `node node_modules/expo/bin/cli <command>` directly for everything.

**`--legacy-peer-deps` needed**
npm peer dep resolution fails when mixing React 19 with some Expo packages. Always use `npm install --legacy-peer-deps` if npm errors on install.

### Stack confirmed working
- Expo SDK 54
- React 19.1.0 + React Native 0.81.5
- expo-sqlite, expo-av, expo-file-system, expo-location
- Physical device via Expo Go (no Xcode needed at this stage)
