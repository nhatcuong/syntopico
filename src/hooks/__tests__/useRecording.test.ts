import { renderHook, act } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { useRecording } from '../useRecording';

// ---------------------------------------------------------------------------
// Module mocks
// All of these are hoisted to the top of the file by Jest before any imports.
// ---------------------------------------------------------------------------

/**
 * expo-audio: mock the recorder hook and permission/mode utilities.
 * useAudioRecorder returns a recorder object with the minimal API surface
 * useRecording calls: prepareToRecordAsync, record, stop, uri.
 */
jest.mock('expo-audio', () => {
  const mockRecorder = {
    prepareToRecordAsync: jest.fn().mockResolvedValue(undefined),
    record: jest.fn(),
    stop: jest.fn().mockResolvedValue(undefined),
    uri: 'file://tmp/recording.m4a',
  };
  return {
    useAudioRecorder: jest.fn().mockReturnValue(mockRecorder),
    useAudioRecorderState: jest.fn().mockReturnValue({ durationMillis: 0, isRecording: false, metering: -60 }),
    RecordingPresets: { HIGH_QUALITY: {} },
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    requestRecordingPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  };
});

/**
 * expo-file-system: mock Directory and File classes.
 * Directory is always considered to exist so create() is never called.
 * File.move() is a no-op (we don't care about file system side effects).
 * File.uri is a plausible local path used downstream as the transcription input.
 */
jest.mock('expo-file-system', () => ({
  Directory: jest.fn().mockImplementation(() => ({
    exists: true,
    create: jest.fn(),
  })),
  File: jest.fn().mockImplementation((_arg1: string, arg2?: string) => ({
    move: jest.fn(),
    // When called as new File(dir, filename), uri reflects the destination path.
    uri: arg2
      ? `file://documents/recordings/${arg2}`
      : 'file://tmp/recording.m4a',
  })),
  Paths: { document: 'file://documents' },
}));

/**
 * Whisper: always returns a fixed transcript string.
 * The actual content doesn't matter for these tests — what matters is what
 * extractBookInfo does with it.
 */
jest.mock('../../services/whisper', () => ({
  transcribeAudio: jest.fn().mockResolvedValue('Test transcript text.'),
  WhisperError: class WhisperError extends Error {
    constructor(msg: string) { super(msg); this.name = 'WhisperError'; }
  },
}));

/**
 * extract: default mock returns null title (the scenario we're testing).
 * Individual tests override this via mockResolvedValueOnce when needed.
 * blocks replaces the old flat note string as of T03.
 */
jest.mock('../../services/extract', () => ({
  extractBookInfo: jest.fn().mockResolvedValue({
    title: null,
    author: null,
    chapter: null,
    blocks: [{ type: 'thought', text: 'A generic reading note.', location: null }],
  }),
  extractNoteOnly: jest.fn().mockResolvedValue({
    chapter: null,
    blocks: [{ type: 'thought', text: 'A note from the pinned book flow.', location: null }],
  }),
  ExtractError: class ExtractError extends Error {
    constructor(msg: string) { super(msg); this.name = 'ExtractError'; }
  },
}));

/**
 * Google Books: not reached in these tests (null title skips the metadata
 * fetch), but mocked to prevent any accidental real network calls.
 */
jest.mock('../../services/googleBooks', () => ({
  fetchBookMetadata: jest.fn().mockResolvedValue(null),
  GoogleBooksError: class GoogleBooksError extends Error {
    constructor(msg: string) { super(msg); this.name = 'GoogleBooksError'; }
  },
}));

/**
 * matchBook: not reached for null-title path (we never try to match a null
 * title against existing books).
 */
jest.mock('../../services/matchBook', () => ({
  findMatchingBook: jest.fn().mockReturnValue(null),
}));

/**
 * Sentry: no-op all methods so analytics calls don't fail in test environment.
 */
jest.mock('@sentry/react-native', () => ({
  addBreadcrumb: jest.fn(),
  init: jest.fn(),
  captureException: jest.fn(),
}));

/**
 * database: the key mock for these tests.
 * - getBooksByLastSession() is overridden per-test to control whether books exist.
 * - insertReadingSession() returns a fake session ID.
 * - insertBook() is mocked but should not be called in the null-title path.
 */
jest.mock('../../db/database', () => ({
  getBooksByLastSession: jest.fn(),
  insertBook: jest.fn().mockReturnValue(99),
  insertReadingSession: jest.fn().mockReturnValue(42),
}));

// ---------------------------------------------------------------------------
// Import mocked modules so we can configure them per-test
// ---------------------------------------------------------------------------

import { getBooksByLastSession, insertReadingSession } from '../../db/database';
import { extractBookInfo, extractNoteOnly, ExtractError } from '../../services/extract';

import { useAudioRecorderState } from 'expo-audio';
import { transcribeAudio } from '../../services/whisper';
import { findMatchingBook } from '../../services/matchBook';
import { insertBook } from '../../db/database';

const book = {
  id: 5, title: 'Deep Work', author: 'Cal Newport', coverUrl: null,
  isbn: null, googleBooksId: null, description: null, pageCount: null,
  createdAt: '2026-01-01T00:00:00Z', lastSessionAt: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  (useAudioRecorderState as jest.Mock).mockReturnValue({
    durationMillis: 0, isRecording: false, metering: -60,
  });
  (getBooksByLastSession as jest.Mock).mockReturnValue([book]);
});

afterEach(() => jest.restoreAllMocks());

async function capture(options: { pinned?: number; metering?: number; duration?: number } = {}) {
  const onComplete = jest.fn();
  const hook = renderHook(() => useRecording(onComplete, options.pinned));
  await act(async () => { await hook.result.current.start(); });
  (useAudioRecorderState as jest.Mock).mockReturnValue({
    durationMillis: options.duration ?? 3000,
    isRecording: true,
    metering: options.metering ?? -20,
  });
  // start() resets sound detection; deliver a sample during this recording.
  hook.rerender({});
  await act(async () => { await hook.result.current.stop(); });
  return { ...hook, onComplete };
}

describe('useRecording — unidentified book', () => {
  it.each([['populated', [book]], ['empty', []]])(
    'rejects an unidentified note with a %s library', async (_label, books) => {
      (getBooksByLastSession as jest.Mock).mockReturnValue(books);
      const { result, onComplete } = await capture();
      expect(extractBookInfo).toHaveBeenCalledWith('Test transcript text.');
      expect(result.current.state).toBe('idle');
      expect(onComplete).not.toHaveBeenCalled();
      expect(insertReadingSession).not.toHaveBeenCalled();
      expect(insertBook).not.toHaveBeenCalled();
      expect(Alert.alert).toHaveBeenCalledWith(
        "Couldn't identify a book",
        "We couldn't tell what book this was about, so the note wasn't saved.",
      );
    },
  );

  it('routes a recognized title to its matching book', async () => {
    (extractBookInfo as jest.Mock).mockResolvedValueOnce({
      title: 'Deep Work', author: 'Cal Newport', chapter: null,
      blocks: [{ type: 'thought', text: 'Focus matters.', location: null }],
    });
    (findMatchingBook as jest.Mock).mockReturnValueOnce(book);
    const { result, onComplete } = await capture();
    expect(result.current.state).toBe('done');
    expect(onComplete).toHaveBeenCalledWith({ bookId: 5, sessionId: 42 });
    expect(insertReadingSession).toHaveBeenCalledWith(
      5, expect.objectContaining({ title: 'Deep Work' }), 'Test transcript text.',
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('useRecording — pinned book', () => {
  it('saves extracted blocks under the pinned book', async () => {
    const { onComplete } = await capture({ pinned: 5 });
    expect(onComplete).toHaveBeenCalledWith({ bookId: 5, sessionId: 42 });
    expect(extractNoteOnly).toHaveBeenCalledWith('Test transcript text.', 'Deep Work', 'Cal Newport');
    expect(extractBookInfo).not.toHaveBeenCalled();
    expect(insertReadingSession).toHaveBeenCalledWith(
      5, expect.objectContaining({ blocks: expect.any(Array) }), 'Test transcript text.',
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('preserves the transcript with a null note if extraction fails', async () => {
    (extractNoteOnly as jest.Mock).mockRejectedValueOnce(new ExtractError('Truncated output'));
    const { onComplete } = await capture({ pinned: 5 });
    expect(onComplete).toHaveBeenCalledWith({ bookId: 5, sessionId: 42 });
    expect(insertReadingSession).toHaveBeenCalledWith(
      5, { chapter: null, blocks: null }, 'Test transcript text.',
    );
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe('useRecording — speech guards', () => {
  it.each([-60, -40])('rejects metering %s dB before calling Whisper', async metering => {
    const { result, onComplete } = await capture({ metering });
    expect(result.current.state).toBe('idle');
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(insertReadingSession).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("Didn't catch anything", 'No speech was detected in that recording.');
  });

  it('discards recordings shorter than 1.5 seconds before calling Whisper', async () => {
    const { result } = await capture({ duration: 1499 });
    expect(result.current.state).toBe('idle');
    expect(transcribeAudio).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('rejects an empty transcript before extraction or saving', async () => {
    (transcribeAudio as jest.Mock).mockResolvedValueOnce('   ');
    const { result } = await capture();
    expect(result.current.state).toBe('idle');
    expect(extractBookInfo).not.toHaveBeenCalled();
    expect(insertReadingSession).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith("Didn't catch anything", 'No speech was detected in that recording.');
  });
});
