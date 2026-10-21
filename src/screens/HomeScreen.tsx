import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Image,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { getBooksByLastSession, BookRow } from '../db/database';
import { importBook } from '../services/bookBackup';
import { useRecording } from '../hooks/useRecording';
import { RootStackParamList } from '../navigation/types';
import CentralInfoDisplay from '../components/CentralInfoDisplay';
import Wordmark from '../components/Wordmark';
import { useSetFabConfig } from '../contexts/FabController';
import { NAVY, ACCENT, MUTED, FAINT, PAPER, SURFACE, HAIRLINE, CARD_SHADOW } from '../tokens';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

// Cover container is a fixed 1:1.5 box (the most common book-cover ratio).
// Covers are scaled to fit inside it without cropping — since RN's
// resizeMode:'contain' always centers its content within the Image
// element's own box (no way to anchor it left directly), getting a real
// left-aligned/vertically-centered result means computing each cover's
// actual displayed size from its natural dimensions, then sizing the Image
// element to match exactly — so there's no internal letterboxing left for
// resizeMode to center on its own.
const COVER_CONTAINER_WIDTH = 52;
const COVER_CONTAINER_HEIGHT = COVER_CONTAINER_WIDTH * 1.5;

export default function HomeScreen({ navigation }: Props) {
  const [books, setBooks] = useState<BookRow[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [coverSizes, setCoverSizes] = useState<Record<number, { width: number; height: number }>>({});

  function loadBooks() {
    setBooks(getBooksByLastSession());
  }

  useFocusEffect(useCallback(() => { loadBooks(); }, []));

  useEffect(() => {
    books.forEach(book => {
      if (!book.coverUrl || coverSizes[book.id]) return;
      Image.getSize(
        book.coverUrl,
        (width, height) => setCoverSizes(prev => ({ ...prev, [book.id]: { width, height } })),
        () => {}
      );
    });
    // Deliberately depends on `books` only, not `coverSizes` — books already
    // changes on every screen focus (loadBooks), which is enough to pick up
    // anything newly missing. Depending on coverSizes too would re-run this
    // effect as each fetch resolves, re-firing Image.getSize for any other
    // covers still in flight at that moment (guard only skips ones already
    // resolved, not ones merely requested).
  }, [books]);

  const { state, durationMs, start, stop, cleanup } = useRecording(({ bookId, sessionId }) => {
    loadBooks();
    navigation.navigate('Book', { bookId, highlightSessionId: sessionId });
  });

  useEffect(() => () => cleanup(), []);

  const isRecording  = state === 'recording';
  const isProcessing = state === 'transcribing' || state === 'extracting';
  const showOverlay  = isRecording || isProcessing;

  // Registers this screen's FAB behavior with the single, app-wide FAB —
  // only takes effect while Home is the focused screen. Re-runs whenever
  // the recording state changes (not just on focus/blur), since the
  // memoized callback's identity changes with its dependencies.
  const setFabConfig = useSetFabConfig();
  useFocusEffect(useCallback(() => {
    setFabConfig({
      fabState: isRecording ? 'recording' : isProcessing ? 'processing' : 'idle',
      onPress: isRecording ? stop : start,
      overlay: showOverlay
        ? { state: state as 'recording' | 'transcribing' | 'extracting', durationMs, customLabel: 'Record your new reading note' }
        : null,
    });
  }, [isRecording, isProcessing, showOverlay, state, durationMs, start, stop]));

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    });
  }

  async function handleImport() {
    setMenuOpen(false);
    try {
      const result = await importBook();
      if (result.status === 'cancelled') return;
      loadBooks();
      const msg = result.status === 'merged'
        ? `Notes imported into existing "${result.bookTitle}".`
        : `"${result.bookTitle}" imported successfully.`;
      Alert.alert('Import complete', msg, [
        { text: 'View book', onPress: () => navigation.navigate('Book', { bookId: result.bookId }) },
        { text: 'OK' },
      ]);
    } catch (err: any) {
      Alert.alert('Import failed', err.message ?? 'Could not import file.');
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.headerRow}>
        <Wordmark />
        <TouchableOpacity onPress={() => setMenuOpen(true)} style={styles.menuButton} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={styles.menuDots}>⋯</Text>
        </TouchableOpacity>
      </View>

      {/* Book list */}
      {books.length === 0 ? (
        <CentralInfoDisplay title="What are you reading?">
          <Text style={styles.emptySubtitle}>
            Say the book, the chapter, and what's on your mind, like you're talking to a friend!
          </Text>
        </CentralInfoDisplay>
      ) : (
        <FlatList
          data={books}
          keyExtractor={b => b.id.toString()}
          contentContainerStyle={styles.list}
          renderItem={({ item, index }) => {
            const natural = item.coverUrl ? coverSizes[item.id] : null;
            const coverDisplaySize = natural
              ? {
                  width: natural.width * Math.min(COVER_CONTAINER_WIDTH / natural.width, COVER_CONTAINER_HEIGHT / natural.height),
                  height: natural.height * Math.min(COVER_CONTAINER_WIDTH / natural.width, COVER_CONTAINER_HEIGHT / natural.height),
                }
              : { width: COVER_CONTAINER_WIDTH, height: COVER_CONTAINER_HEIGHT };

            return (
              <TouchableOpacity
                style={[styles.bookCard, index === 0 && styles.bookCardActive]}
                onPress={() => navigation.navigate('Book', { bookId: item.id })}
                activeOpacity={0.75}
              >
                <View style={styles.coverContainer}>
                  {item.coverUrl ? (
                    <Image source={{ uri: item.coverUrl }} style={coverDisplaySize} resizeMode="contain" />
                  ) : (
                    <View style={styles.coverPlaceholder} />
                  )}
                </View>
                <View style={styles.bookInfo}>
                  <Text style={styles.bookTitle} numberOfLines={2}>{item.title}</Text>
                  {item.author && <Text style={styles.bookAuthor}>{item.author}</Text>}
                  {item.lastSessionAt && (
                    <View style={styles.dateRow}>
                      {index === 0 && <View style={styles.activeDot} />}
                      <Text style={styles.bookDate}>Last note {formatDate(item.lastSessionAt)}</Text>
                    </View>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
        />
      )}

      {/* Menu */}
      {menuOpen && (
        <View style={[StyleSheet.absoluteFillObject, { zIndex: 999 }]}>
          <TouchableOpacity style={StyleSheet.absoluteFillObject} activeOpacity={1} onPress={() => setMenuOpen(false)} />
          <View style={styles.menuCard}>
            <TouchableOpacity style={styles.menuItem} onPress={handleImport}>
              <Text style={styles.menuItemText}>Import book</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: PAPER,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 14,
  },
  menuButton: {
    padding: 4,
  },
  menuDots: {
    fontSize: 22,
    color: NAVY,
    letterSpacing: 1,
  },
  menuCard: {
    position: 'absolute',
    top: 56,
    right: 16,
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
  list: {
    paddingHorizontal: 16,
    paddingBottom: 140,
    gap: 11,
  },
  bookCard: {
    flexDirection: 'row',
    // Without this, the cover (fixed-height, doesn't stretch) sits at the
    // top of the row whenever bookInfo's content (e.g. a 2-line title) is
    // taller than the cover container — leaving empty space below it.
    alignItems: 'center',
    backgroundColor: SURFACE,
    borderRadius: 14,
    overflow: 'hidden',
    ...CARD_SHADOW,
  },
  bookCardActive: {
    borderWidth: 1,
    borderColor: ACCENT + 'AA',
    shadowOpacity: 0.1,
    shadowRadius: 16,
  },
  // Fixed 1:1.5 box; the Image inside is sized dynamically per-cover (see
  // coverDisplaySize in renderItem) to its actual scaled dimensions, so
  // justifyContent/alignItems here position the real visible content
  // directly — not just the image element's own (otherwise full-box) frame.
  coverContainer: {
    width: COVER_CONTAINER_WIDTH,
    height: COVER_CONTAINER_HEIGHT,
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  coverPlaceholder: {
    width: '100%',
    height: '100%',
    backgroundColor: '#C8BFAF',
  },
  bookInfo: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 13,
    gap: 3,
    justifyContent: 'center',
  },
  bookTitle: {
    fontFamily: 'Newsreader_600SemiBold',
    fontSize: 17,
    color: NAVY,
    lineHeight: 21,
    letterSpacing: -0.2,
  },
  bookAuthor: {
    fontSize: 13,
    color: MUTED,
  },
  dateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: ACCENT,
  },
  bookDate: {
    fontSize: 12,
    color: FAINT,
  },
  emptySubtitle: {
    fontSize: 19,
    color: MUTED,
    textAlign: 'center',
    lineHeight: 26,
  },
});
