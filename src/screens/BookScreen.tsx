import { useState, useEffect, useCallback, useRef, ElementRef } from 'react';
import {
  View,
  Text,
  Animated,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getBookById, getSessionsByBookId, getBooksByLastSession, deleteBook, deleteSession, reassignSession, updateSessionNote, insertBook, BookRow, SessionRow } from '../db/database';
import { exportBook } from '../services/bookBackup';
import { useRecording } from '../hooks/useRecording';
import { useVoiceCapture } from '../hooks/useVoiceCapture';
import { extractBookInfo, extractNoteOnly, amendNote } from '../services/extract';
import { fetchBookMetadata } from '../services/googleBooks';
import { findMatchingBook } from '../services/matchBook';
import { RootStackParamList } from '../navigation/types';
import NoteBlocksRenderer from '../components/NoteBlocksRenderer';
import Fab from '../components/Fab';
import RecordingOverlay from '../components/RecordingOverlay';
import { NAVY, ACCENT, MUTED, FAINT, DESTRUCTIVE, BODY, PAPER, SURFACE, HAIRLINE, CARD_SHADOW } from '../tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Book'>;

// Scroll distance over which the hero (cover + title) collapses into the
// compact title that crossfades into the fixed nav row.
const HERO_HEIGHT = 176;
const COLLAPSE_RANGE = 130;

// Visual height of the nav row at rest — just the chevron/menu. headerRow
// itself is always COMPACT_HEADER_HEIGHT tall (below) so it never has to
// resize once the compact cover needs that room, but headerButtonsRow (its
// only real content at rest) is anchored to its top rather than centered,
// and heroOverlay's rest position overlaps the row's unused lower portion
// (see heroOverlay's own comment) — together making it *read* as this
// shorter height at rest, with no dead space between the buttons and the
// hero below them.
const HEADER_REST_HEIGHT = 56;

// The nav row's height is DERIVED from the compact cover's size, not an
// independently-chosen number — it must always be exactly big enough to
// fit the cover plus top/bottom padding. Picking these separately (as an
// earlier version of this file did) lets the row height and cover size
// silently drift out of sync any time either one changes. Top/bottom are
// intentionally asymmetric (more room below than above). One constant,
// always-opaque, full-width row (rather than a resizing row, or a second,
// disconnected fixed-size overlay) avoids both a seam where scrolled
// content could show through, and the row visibly resizing at all.
const COMPACT_COVER_WIDTH = 58;
const COMPACT_COVER_HEIGHT = 84;
const COMPACT_HEADER_PADDING_TOP = 3;
const COMPACT_HEADER_PADDING_BOTTOM = 12;
const COMPACT_HEADER_HEIGHT =
  COMPACT_COVER_HEIGHT + COMPACT_HEADER_PADDING_TOP + COMPACT_HEADER_PADDING_BOTTOM;
// How much of headerRow's own (constant) height sits unused at rest, below
// where the chevron/menu row ends — this is exactly how far heroOverlay's
// rest position (and heroSpacer's rest height) get pulled up, so that
// unused space is reclaimed rather than left as a gap.
const HEADER_UNUSED_REST_SPACE = COMPACT_HEADER_HEIGHT - HEADER_REST_HEIGHT;

export default function BookScreen({ navigation, route }: Props) {
  const { bookId, highlightSessionId } = route.params;

  const [book, setBook] = useState<BookRow | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(highlightSessionId ?? null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [wrongBookSessionId, setWrongBookSessionId] = useState<number | null>(null);
  const [amendSessionId, setAmendSessionId] = useState<number | null>(null);
  const [reprocessingId, setReprocessingId] = useState<number | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);

  const scrollViewRef = useRef<ElementRef<typeof ScrollView>>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  // Chevron and compact title crossfade over this range, and hand off
  // interactivity (below, via isCollapsed) at its midpoint so there's
  // never a gap or overlap in what's tappable.
  const CROSSFADE_START = COLLAPSE_RANGE * 0.55;
  const CROSSFADE_MIDPOINT = (CROSSFADE_START + COLLAPSE_RANGE) / 2;
  // Drives heroSpacer below — an invisible placeholder that frees up the
  // hero's layout space (so the list slides up to fill it) without itself
  // rendering anything, so nothing here ever needs to crop visible content.
  // Its rest value is HERO_HEIGHT minus HEADER_UNUSED_REST_SPACE, not
  // HERO_HEIGHT itself — heroOverlay's rest position (below) is pulled up
  // by that same amount, overlapping headerRow's own unused space instead
  // of sitting below it, so this doesn't also reserve room for it there —
  // that would just reopen the same dead space one row lower, between the
  // hero and the list. Finishes shrinking exactly at CROSSFADE_START, the
  // same point the compact header content (below) starts fading in — one
  // clean handoff.
  const heroHeight = scrollY.interpolate({
    inputRange: [0, CROSSFADE_START],
    outputRange: [HERO_HEIGHT - HEADER_UNUSED_REST_SPACE, 0],
    extrapolate: 'clamp',
  });
  // heroOverlay (below) has a higher zIndex than headerRow and the scroll
  // content, so as it translates up it paints over both rather than being
  // hidden behind either — the same crossfade-over-whatever's-underneath
  // relationship headerRow's own chevron/compact-title swap already uses.
  // That means neither headerRow occluding it nor it overlapping the list
  // are actual problems, so heroTranslateY and heroOpacity just need to
  // finish together, 30% faster than heroHeight above shrinks (i.e. over a
  // shorter scroll distance) per feedback on the pace.
  const HERO_MOVE_RANGE = CROSSFADE_START / 1.3;
  // Capped at -HEADER_REST_HEIGHT (heroOverlay's rest top, below) so its top
  // edge lands flush with this screen's own top edge and never goes past
  // it — that boundary (unlike headerRow) has nothing covering it, and
  // heroOverlay has no overflow clipping of its own, so going further would
  // render into the safe-area inset/status-bar region uncropped.
  const heroTranslateY = scrollY.interpolate({
    inputRange: [0, HERO_MOVE_RANGE],
    outputRange: [0, -HEADER_REST_HEIGHT],
    extrapolate: 'clamp',
  });
  const heroOpacity = scrollY.interpolate({
    inputRange: [0, HERO_MOVE_RANGE],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });
  const compactTitleOpacity = scrollY.interpolate({
    inputRange: [CROSSFADE_START, COLLAPSE_RANGE],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const chevronOpacity = scrollY.interpolate({
    inputRange: [CROSSFADE_START, COLLAPSE_RANGE],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  function handleScroll(event: { nativeEvent: { contentOffset: { y: number } } }) {
    setIsCollapsed(event.nativeEvent.contentOffset.y >= CROSSFADE_MIDPOINT);
  }

  function expandHeader() {
    scrollViewRef.current?.scrollTo({ y: 0, animated: true });
  }

  function load() {
    setBook(getBookById(bookId));
    setSessions(getSessionsByBookId(bookId));
  }

  useFocusEffect(useCallback(() => { load(); }, [bookId]));

  const { state, durationMs, start, stop, cleanup } = useRecording(({ sessionId }) => {
    load();
    setExpandedId(sessionId);
  }, bookId);

  useEffect(() => () => cleanup(), []);

  const amendCapture = useVoiceCapture((transcript) => {
    if (amendSessionId !== null) {
      const sid = amendSessionId;
      setAmendSessionId(null);
      handleAmend(sid, transcript);
    }
  });

  const wrongBookCapture = useVoiceCapture((transcript) => {
    if (wrongBookSessionId !== null) {
      const sid = wrongBookSessionId;
      setWrongBookSessionId(null);
      handleWrongBook(sid, transcript);
    }
  });

  const isRecording    = state === 'recording';
  const isProcessing   = state === 'transcribing' || state === 'extracting';
  const showOverlay    = isRecording || isProcessing;
  const amendIsActive  = amendCapture.state !== 'idle';
  const wrongBookIsActive = wrongBookCapture.state !== 'idle';

  async function handleExport() {
    setMenuOpen(false);
    try {
      await exportBook(bookId);
    } catch (err: any) {
      Alert.alert('Export failed', err.message ?? 'Could not export book.');
    }
  }

  function handleDelete() {
    setMenuOpen(false);
    Alert.alert(
      'Delete book',
      `Delete "${book?.title}" and all its notes? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => { deleteBook(bookId); navigation.goBack(); },
        },
      ]
    );
  }

  async function handleWrongBook(sessionId: number, transcript: string) {
    try {
      const extracted = await extractBookInfo(transcript);
      if (!extracted.title) {
        Alert.alert("Couldn't identify", "We couldn't identify the book. Try again.");
        return;
      }
      const existing = getBooksByLastSession();
      const match = findMatchingBook(extracted.title, existing);
      let newBookId: number;
      if (match) {
        newBookId = match.id;
      } else {
        const metadata = await fetchBookMetadata(extracted.title, extracted.author);
        newBookId = insertBook(metadata, extracted);
      }
      reassignSession(sessionId, newBookId);
      if (newBookId === bookId) {
        load();
      } else {
        navigation.replace('Book', { bookId: newBookId, highlightSessionId: sessionId });
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not move note.');
    }
  }

  async function handleAmend(sessionId: number, transcript: string) {
    const session = sessions.find(s => s.id === sessionId);
    if (!session?.note) return;
    try {
      const updatedBlocks = await amendNote(session.note, transcript, book?.title ?? '', book?.author ?? null);
      updateSessionNote(sessionId, updatedBlocks);
      load();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Could not amend note.');
    }
  }

  async function handleReprocess(sessionId: number) {
    const session = sessions.find(s => s.id === sessionId);
    if (!session?.rawTranscript) return;
    setReprocessingId(sessionId);
    try {
      const { blocks } = await extractNoteOnly(session.rawTranscript, book?.title ?? '', book?.author ?? null);
      updateSessionNote(sessionId, blocks);
      load();
    } catch (err: any) {
      Alert.alert('Still failed', err.message ?? 'Could not process this note. Try again later.');
    } finally {
      setReprocessingId(null);
    }
  }

  function handleDeleteSession(sessionId: number) {
    Alert.alert(
      'Delete note',
      'Delete this note? This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => { deleteSession(sessionId); load(); } },
      ]
    );
  }

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  return (
    <SafeAreaView style={styles.container}>
    <View style={styles.content}>
      {/* Header — one always-opaque, full-width row, fixed at its final
          (compact-cover-sized) height from the very start. It never grows —
          only its content crossfades: the chevron/menu row fades out as the
          compact cover+title fades in, in place. */}
      <Animated.View style={styles.headerRow}>
        <View style={styles.headerButtonsRow}>
          <Animated.View style={{ opacity: chevronOpacity }} pointerEvents={isCollapsed ? 'none' : 'auto'}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.navButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={styles.backChevron}>‹</Text>
            </TouchableOpacity>
          </Animated.View>
          <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.navButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text style={styles.menuDots}>⋯</Text>
          </TouchableOpacity>
        </View>

        {/* Compact title — invisible (opacity 0, pointerEvents none) until
            scrolled past the collapse point, so it never affects the
            expanded/at-rest look even though its box is always present. */}
        <Animated.View style={styles.compactTitleTouchable} pointerEvents={isCollapsed ? 'auto' : 'none'}>
          <TouchableOpacity onPress={expandHeader} activeOpacity={0.7} style={styles.compactTitleTouchableInner}>
            <Animated.View style={[styles.compactTitle, { opacity: compactTitleOpacity }]}>
              {book?.coverUrl ? (
                <Image source={{ uri: book.coverUrl }} style={styles.compactCover} resizeMode="cover" />
              ) : (
                <View style={styles.compactCoverPlaceholder} />
              )}
              <View style={styles.compactTextBlock}>
                <Text style={styles.compactTitleText} numberOfLines={1}>{book?.title}</Text>
                {book?.author && <Text style={styles.compactAuthorText} numberOfLines={1}>{book.author}</Text>}
              </View>
            </Animated.View>
          </TouchableOpacity>
        </Animated.View>

        {/* Full-width bottom border, fading in with the same crossfade as
            the compact title — gives the collapsed header some physical
            separation from the scrolling content, invisible at rest. */}
        <Animated.View style={[styles.headerBottomDivider, { opacity: compactTitleOpacity }]} pointerEvents="none" />
      </Animated.View>

      {/* Invisible placeholder — frees up the hero's layout space (so the
          list slides up to fill it) as the list scrolls. Renders nothing;
          the hero's actual visual content is heroOverlay, below. */}
      <Animated.View style={{ height: heroHeight }} />

      <Animated.ScrollView
        ref={scrollViewRef}
        contentContainerStyle={styles.scroll}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false, listener: handleScroll }
        )}
        scrollEventThrottle={16}
      >
        <View style={styles.divider} />

        {/* Sessions */}
        {sessions.length === 0 ? (
          <Text style={styles.noSessions}>No notes yet</Text>
        ) : (
          sessions.map(session => {
            const isExpanded  = expandedId === session.id;
            const isHighlighted = session.id === highlightSessionId;
            return (
              <TouchableOpacity
                key={session.id}
                style={[styles.sessionItem, isHighlighted && styles.sessionHighlighted]}
                onPress={() => setExpandedId(isExpanded ? null : session.id)}
                activeOpacity={0.75}
              >
                <View style={styles.sessionHeader}>
                  <Text style={styles.sessionDate}>{formatDate(session.sessionDate)}</Text>
                  {session.chapter && <Text style={styles.sessionChapter}>{session.chapter}</Text>}
                </View>
                {session.note === null ? (
                  isExpanded ? (
                    <View style={styles.fallbackContainer}>
                      <Text style={styles.fallbackBanner}>Processing failed — showing raw transcript</Text>
                      <Text style={styles.fallbackText}>{session.rawTranscript}</Text>
                    </View>
                  ) : (
                    <Text style={styles.fallbackBanner} numberOfLines={2}>
                      Processing failed — showing raw transcript
                    </Text>
                  )
                ) : (
                  <NoteBlocksRenderer blocks={session.note} collapsed={!isExpanded} />
                )}
                {isExpanded && (
                  <View style={styles.sessionActions}>
                    <TouchableOpacity
                      onPress={(e) => { e.stopPropagation(); setWrongBookSessionId(session.id); wrongBookCapture.start(); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <View style={styles.recordTrigger}>
                        <Text style={styles.sessionAction}>Wrong book?</Text>
                        <View style={styles.recordDot} />
                      </View>
                    </TouchableOpacity>
                    <View style={styles.sessionActionsRight}>
                      {session.note === null ? (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation(); handleReprocess(session.id); }}
                          disabled={reprocessingId === session.id}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Text style={styles.sessionAction}>
                            {reprocessingId === session.id ? 'Re-processing…' : 'Re-process'}
                          </Text>
                        </TouchableOpacity>
                      ) : (
                        <TouchableOpacity
                          onPress={(e) => { e.stopPropagation(); setAmendSessionId(session.id); amendCapture.start(); }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <View style={styles.recordTrigger}>
                            <Text style={styles.sessionAction}>Amend</Text>
                            <View style={styles.recordDot} />
                          </View>
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        onPress={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text style={[styles.sessionAction, styles.sessionActionDestructive]}>Delete</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        <View style={{ height: 130 }} />
      </Animated.ScrollView>

      {/* Hero's actual visual content — fixed size, no overflow clipping,
          never itself resized or cropped. Slides up (heroTranslateY) and
          fades (heroOpacity) together; zIndex above both headerRow and the
          scroll content means it paints over whatever it moves past —
          crossfading over it, the same relationship headerRow's own
          chevron/compact-title swap uses — rather than being hidden behind
          it. pointerEvents none — it has no interactive elements, and
          shouldn't block taps on whatever's scrolled underneath it. */}
      <Animated.View
        style={[
          styles.heroOverlay,
          { opacity: heroOpacity, transform: [{ translateY: heroTranslateY }] },
        ]}
        pointerEvents="none"
      >
        {book && (
          <View style={styles.bookHeader}>
            {book.coverUrl ? (
              <Image source={{ uri: book.coverUrl }} style={styles.cover} resizeMode="cover" />
            ) : (
              <View style={styles.coverPlaceholder} />
            )}
            <View style={styles.bookMeta}>
              <Text style={styles.bookTitle}>{book.title}</Text>
              {book.author && <Text style={styles.bookAuthor}>by {book.author}</Text>}
              {book.pageCount != null && <Text style={styles.bookDetail}>{book.pageCount} pages</Text>}
              {book.isbn && <Text style={styles.bookDetail}>ISBN {book.isbn}</Text>}
            </View>
          </View>
        )}
      </Animated.View>

      {/* Recording overlay */}
      {showOverlay && (
        <RecordingOverlay
          state={state as 'recording' | 'transcribing' | 'extracting'}
          durationMs={durationMs}
          customLabel="Record your new reading note"
        />
      )}
      {amendIsActive && (
        <RecordingOverlay
          state={amendCapture.state as 'recording' | 'transcribing'}
          durationMs={amendCapture.durationMs}
          customLabel="Amend a reading note"
        />
      )}
      {wrongBookIsActive && (
        <RecordingOverlay
          state={wrongBookCapture.state as 'recording' | 'transcribing'}
          durationMs={wrongBookCapture.durationMs}
          customLabel="What book was that?"
        />
      )}

      {/* Menu */}
      {menuOpen && (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 999 }]}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setMenuOpen(false)} />
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={handleExport}>
              <Text style={styles.menuItemText}>Export notes</Text>
            </TouchableOpacity>
            <View style={styles.menuDivider} />
            <TouchableOpacity style={styles.menuItem} onPress={handleDelete}>
              <Text style={styles.menuItemDestructive}>Delete book</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>

      {/* FAB — deliberately a direct child of SafeAreaView, not of
          `content`: `content`'s box excludes the bottom safe-area inset
          (needed so heroOverlay gets the top inset), which would push the
          FAB up by that inset's height too. Home screen's FAB sits at the
          same true distance from the bottom edge, so this keeps both
          screens visually consistent. */}
      <View style={styles.fabContainer}>
        <Fab
          fabState={
            wrongBookCapture.state === 'recording'    ? 'recording'  :
            wrongBookCapture.state === 'transcribing' ? 'processing' :
            amendCapture.state === 'recording'        ? 'recording'  :
            amendCapture.state === 'transcribing'     ? 'processing' :
            isRecording ? 'recording' : isProcessing  ? 'processing' : 'idle'
          }
          onPress={
            wrongBookCapture.state === 'recording' ? wrongBookCapture.stop :
            amendCapture.state === 'recording'     ? amendCapture.stop     :
            isRecording ? stop : start
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PAPER,
  },
  // position:relative anchor for heroOverlay's absolute positioning — a
  // direct child of SafeAreaView isn't reliable for this, since SafeAreaView
  // applies the top safe-area inset in a way absolutely-positioned children
  // don't consistently inherit, unlike normal-flow siblings like headerRow.
  // overflow:hidden crops heroOverlay once heroTranslateY carries it above
  // this box's own top edge — that point is the safe-area inset itself
  // (status bar/notch), which nothing else here occupies or covers, so
  // without this the overflowing sliver renders there uncovered.
  content: {
    flex: 1,
    overflow: 'hidden',
  },
  // Always opaque + full width, fixed at its final (compact-cover-sized)
  // height from the start — it never grows, so there's no seam or overflow
  // risk from content not yet fitting; only opacity ever crossfades inside it.
  headerRow: {
    height: COMPACT_HEADER_HEIGHT,
    paddingHorizontal: 16,
    flexDirection: 'row',
    // flex-start, not center: headerButtonsRow is this row's only real
    // content at rest, and anchoring it to the top (rather than centering
    // it in the full, taller-than-it-needs-to-be height) is what makes the
    // row read as a plain, slim nav bar at rest instead of an oversized one
    // with dead space around the buttons — see HEADER_REST_HEIGHT's comment.
    alignItems: 'flex-start',
    position: 'relative',
    // Sibling paint order in RN follows JSX order regardless of position,
    // and this is declared before the ScrollView — without an explicit
    // zIndex, scrolled session cards paint on top of (and show through)
    // this row instead of staying underneath it.
    zIndex: 10,
    backgroundColor: PAPER,
    overflow: 'hidden',
  },
  headerButtonsRow: {
    height: HEADER_REST_HEIGHT,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Edge-to-edge, unlike the in-content `divider` (which is inset by the
  // scroll content's own horizontal padding) — this one spans headerRow's
  // full width since it's meant to read as the row's own bottom border.
  headerBottomDivider: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: HAIRLINE,
  },
  navButton: {
    padding: 4,
  },
  backChevron: {
    fontSize: 32,
    color: NAVY,
    lineHeight: 34,
  },
  menuDots: {
    fontSize: 22,
    color: NAVY,
    letterSpacing: 1,
  },
  // Absolutely positioned (relative to headerRow, which is the
  // `position: relative` anchor) so the compact title can start flush with
  // the true left edge once the chevron hides, rather than being boxed in
  // by the chevron's own layout space. Spans headerRow's full (constant)
  // height exactly.
  compactTitleTouchable: {
    position: 'absolute',
    left: 20,
    right: 44,
    top: 0,
    height: COMPACT_HEADER_HEIGHT,
  },
  compactTitleTouchableInner: {
    flex: 1,
  },
  compactTitle: {
    flex: 1,
    // paddingTop/paddingBottom reserve exactly COMPACT_COVER_HEIGHT of
    // content area (by construction, since COMPACT_HEADER_HEIGHT is derived
    // from these same three values) — alignItems then centers the cover
    // and text within that content area relative to each other, while the
    // asymmetric padding controls their position within the row as a whole.
    paddingTop: COMPACT_HEADER_PADDING_TOP,
    paddingBottom: COMPACT_HEADER_PADDING_BOTTOM,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  compactCover: {
    width: COMPACT_COVER_WIDTH,
    height: COMPACT_COVER_HEIGHT,
    borderRadius: 4,
    backgroundColor: '#C8BFAF',
  },
  compactCoverPlaceholder: {
    width: COMPACT_COVER_WIDTH,
    height: COMPACT_COVER_HEIGHT,
    borderRadius: 4,
    backgroundColor: '#C8BFAF',
  },
  compactTextBlock: {
    flexShrink: 1,
  },
  compactTitleText: {
    fontFamily: 'Newsreader_600SemiBold',
    fontSize: 17,
    color: NAVY,
    lineHeight: 20,
  },
  compactAuthorText: {
    fontSize: 13,
    color: MUTED,
    lineHeight: 16,
  },
  menuCard: {
    position: 'absolute',
    top: 56,
    right: 16,
    zIndex: 100,
    backgroundColor: SURFACE,
    borderRadius: 14,
    paddingVertical: 4,
    minWidth: 160,
    shadowColor: NAVY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 14,
    elevation: 8,
  },
  menuItem: {
    paddingVertical: 13,
    paddingHorizontal: 16,
  },
  menuItemText: {
    fontSize: 15,
    color: NAVY,
  },
  menuItemDestructive: {
    fontSize: 15,
    color: DESTRUCTIVE,
  },
  menuDivider: {
    height: 1,
    backgroundColor: HAIRLINE,
  },
  scroll: {
    paddingHorizontal: 20,
    // No paddingTop: headerRow (COMPACT_HEADER_HEIGHT) owns the entire fixed
    // header's height itself, so scroll content starts immediately after it.
    paddingTop: 0,
  },
  // top is HEADER_REST_HEIGHT, not headerRow's own (taller) height — this
  // deliberately overlaps headerRow's unused lower portion (see
  // HEADER_UNUSED_REST_SPACE) rather than sitting flush below all of it, so
  // that unused space reads as reclaimed instead of as a gap. Safe to
  // overlap: zIndex above both headerRow (10) and the scroll content means
  // this paints over them rather than being hidden behind either, and
  // there's nothing else in headerRow's unused portion to cover. Fixed size
  // matching HERO_HEIGHT — it never resizes, so bookHeader inside it is
  // never cropped; heroTranslateY (see JSX usage) is the only thing that
  // ever moves it.
  heroOverlay: {
    position: 'absolute',
    top: HEADER_REST_HEIGHT,
    left: 0,
    right: 0,
    height: HERO_HEIGHT,
    paddingHorizontal: 20,
    zIndex: 20,
  },
  bookHeader: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 8,
    marginBottom: 16,
  },
  cover: {
    width: 104,
    height: 152,
    borderRadius: 4,
    backgroundColor: '#C8BFAF',
  },
  coverPlaceholder: {
    width: 104,
    height: 152,
    borderRadius: 4,
    backgroundColor: '#C8BFAF',
  },
  bookMeta: {
    flex: 1,
    gap: 5,
    justifyContent: 'center',
  },
  bookTitle: {
    fontFamily: 'Newsreader_600SemiBold',
    fontSize: 24,
    color: NAVY,
    lineHeight: 28,
    letterSpacing: -0.4,
  },
  bookAuthor: {
    fontSize: 14,
    color: MUTED,
  },
  bookDetail: {
    fontSize: 12.5,
    color: FAINT,
  },
  divider: {
    height: 1,
    backgroundColor: HAIRLINE,
    // This same divider sits below the expanded hero AND below the
    // collapsed compact header — it needs real breathing room for the
    // former, which also adds a bit on top of the latter's already-tuned
    // COMPACT_HEADER_PADDING_BOTTOM. That's an acceptable trade: the
    // compact state has more room to spare than the expanded one has to
    // lose it from.
    marginBottom: 8,
  },
  noSessions: {
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    marginTop: 32,
  },
  sessionItem: {
    backgroundColor: SURFACE,
    borderRadius: 14,
    padding: 14,
    marginBottom: 11,
    ...CARD_SHADOW,
    gap: 7,
  },
  sessionHighlighted: {
    borderWidth: 1,
    borderColor: ACCENT + 'AA',
    shadowColor: ACCENT,
    shadowOpacity: 0.12,
    shadowRadius: 16,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  sessionDate: {
    fontSize: 11,
    fontWeight: '700',
    color: MUTED,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  sessionChapter: {
    fontFamily: 'Newsreader_400Regular_Italic',
    fontSize: 13.5,
    color: ACCENT,
    lineHeight: 18,
  },
  fallbackContainer: {
    gap: 8,
  },
  fallbackBanner: {
    fontSize: 12.5,
    fontWeight: '700',
    color: DESTRUCTIVE,
  },
  fallbackText: {
    fontSize: 15.5,
    color: BODY,
    lineHeight: 25,
  },
  sessionActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  sessionActionsRight: {
    flexDirection: 'row',
    gap: 16,
  },
  sessionAction: {
    fontSize: 13,
    color: MUTED,
  },
  sessionActionDestructive: {
    color: DESTRUCTIVE,
  },
  recordTrigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  recordDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACCENT,
    opacity: 0.7,
  },
  fabContainer: {
    position: 'absolute',
    bottom: 30,
    alignSelf: 'center',
  },
});
