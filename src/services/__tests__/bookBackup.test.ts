import { importBook, exportBook, bookToMarkdown, BookBackup } from '../bookBackup';
import { insertBook, getBookById, getSessionsByBookId } from '../../db/database';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file://backup.json' }] }),
}));
jest.mock('expo-file-system/legacy', () => ({
  cacheDirectory: 'file://cache/', readAsStringAsync: jest.fn(), writeAsStringAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn(),
}));
jest.mock('../../db/database', () => ({
  getBookById: jest.fn(),
  getSessionsByBookId: jest.fn(),
  getBooksByLastSession: jest.fn().mockReturnValue([]),
  insertBook: jest.fn().mockReturnValue(1),
  insertReadingSessionRaw: jest.fn(),
}));
jest.mock('../matchBook', () => ({ findMatchingBook: jest.fn().mockReturnValue(null) }));

test('import preserves Open Library metadata without a Google ID', async () => {
  const book = {
    googleBooksId: null, title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719',
    coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg', description: 'Description', pageCount: 500,
  };
  (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify({ version: 2, book, sessions: [] }));
  await expect(importBook()).resolves.toMatchObject({ status: 'created', bookId: 1 });
  expect(insertBook).toHaveBeenCalledWith(book, expect.objectContaining({ title: book.title }));
});

const backup: BookBackup = {
  version: 2,
  book: { title: 'Dune', author: 'Frank Herbert', isbn: '9780441172719', coverUrl: null,
    googleBooksId: null, description: 'A book\nabout Arrakis', pageCount: 500 },
  sessions: [
    { sessionDate: '2026-10-21T10:00:00Z', chapter: 'Chapter 3', rawTranscript: 'Original',
      note: [{ type: 'thought', text: 'A thought.' }, { type: 'quote', text: 'Line one\nLine two', location: 'Page 42' }] },
    { sessionDate: '2026-10-20T10:00:00Z', chapter: null, rawTranscript: 'Transcript only', note: null },
  ],
};

test('Markdown preserves metadata, chronological notes, multiline quotes and transcript fallback', () => {
  const markdown = bookToMarkdown(backup);
  expect(markdown).toContain('isbn: "9780441172719"');
  expect(markdown).toContain('description: "A book\\nabout Arrakis"');
  expect(markdown).toContain('## 2026-10-21T10:00:00Z — Chapter 3');
  expect(markdown).toContain('A thought.\n\n> Line one\n> Line two\n> — Page 42');
  expect(markdown).toContain('Transcript only');
  expect(markdown.indexOf('2026-10-20')).toBeLessThan(markdown.indexOf('2026-10-21'));
});

test.each(['markdown', 'json'] as const)('exports a real %s file with matching share metadata', async format => {
  const sharing = require('expo-sharing');
  (getBookById as jest.Mock).mockReturnValue(backup.book);
  (getSessionsByBookId as jest.Mock).mockReturnValue(backup.sessions);
  await exportBook(1, format);
  const uri = format === 'markdown' ? 'file://cache/Dune_notes.md' : 'file://cache/Dune_backup.json';
  const [writtenUri, content] = (FileSystem.writeAsStringAsync as jest.Mock).mock.calls.slice(-1)[0];
  expect(writtenUri).toBe(uri);
  if (format === 'json') expect(JSON.parse(content)).toEqual(backup);
  else {
    expect(content).toContain('# Dune');
    expect(content).toContain('A thought.');
    expect(content).toContain('> Line one\n> Line two\n> — Page 42');
  }
  expect(sharing.shareAsync).toHaveBeenLastCalledWith(uri, expect.objectContaining({
    mimeType: format === 'markdown' ? 'text/markdown' : 'application/json',
  }));
});

test('Markdown handles a book without notes', () => {
  expect(bookToMarkdown({ ...backup, sessions: [] })).toContain('No reading notes yet.');
});
