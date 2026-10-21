import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import {
  getBookById,
  getSessionsByBookId,
  getBooksByLastSession,
  insertBook,
  insertReadingSessionRaw,
} from '../db/database';
import { findMatchingBook } from './matchBook';
import { NoteBlock } from '../types/note';

export type BookBackup = {
  version: 2;
  book: {
    title: string;
    author: string | null;
    coverUrl: string | null;
    isbn: string | null;
    googleBooksId: string | null;
    description: string | null;
    pageCount: number | null;
  };
  sessions: {
    note: NoteBlock[] | null;
    chapter: string | null;
    rawTranscript: string | null;
    sessionDate: string;
  }[];
};

export type ExportFormat = 'markdown' | 'json';

export function bookToMarkdown(backup: BookBackup): string {
  const { book, sessions } = backup;
  const heading = (text: string) => text.replace(/[\r\n]+/g, ' ');
  const metadata = Object.entries(book)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join('\n');
  const notes = [...sessions].sort((a, b) => a.sessionDate.localeCompare(b.sessionDate)).map(session => {
    const title = heading(session.sessionDate) + (session.chapter ? ` — ${heading(session.chapter)}` : '');
    const body = session.note?.length
      ? session.note.map(block => block.type === 'quote'
        ? block.text.split('\n').map(line => `> ${line}`).join('\n') + (block.location ? `\n> — ${heading(block.location)}` : '')
        : block.text).join('\n\n')
      : session.rawTranscript ?? '';
    return `## ${title}\n\n${body}`;
  });
  return `---\n${metadata}\n---\n\n# ${heading(book.title)}\n\n${notes.length ? notes.join('\n\n') : 'No reading notes yet.'}\n`;
}

export async function exportBook(bookId: number, format: ExportFormat = 'markdown'): Promise<void> {
  const book = getBookById(bookId);
  if (!book) throw new Error('Book not found');

  const sessions = getSessionsByBookId(bookId);

  const backup: BookBackup = {
    version: 2,
    book: {
      title: book.title,
      author: book.author,
      coverUrl: book.coverUrl,
      isbn: book.isbn,
      googleBooksId: book.googleBooksId,
      description: book.description,
      pageCount: book.pageCount,
    },
    sessions: sessions.map(s => ({
      note: s.note,
      chapter: s.chapter,
      rawTranscript: s.rawTranscript,
      sessionDate: s.sessionDate,
    })),
  };

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  const stem = book.title.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'book';
  const filename = format === 'markdown' ? `${stem}_notes.md` : `${stem}_backup.json`;
  if (!FileSystem.cacheDirectory) throw new Error('Export storage is unavailable.');
  const uri = FileSystem.cacheDirectory + filename;
  const content = format === 'markdown' ? bookToMarkdown(backup) : JSON.stringify(backup, null, 2);
  await FileSystem.writeAsStringAsync(uri, content);
  await Sharing.shareAsync(uri, {
    mimeType: format === 'markdown' ? 'text/markdown' : 'application/json',
    UTI: format === 'markdown' ? 'net.daringfireball.markdown' : 'public.json',
    dialogTitle: `Export ${book.title}`,
  });
}

export type ImportResult =
  | { status: 'merged'; bookId: number; bookTitle: string }
  | { status: 'created'; bookId: number; bookTitle: string }
  | { status: 'cancelled' };

export async function importBook(): Promise<ImportResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: 'application/json',
    copyToCacheDirectory: true,
  });

  if (result.canceled) return { status: 'cancelled' };

  const raw = await FileSystem.readAsStringAsync(result.assets[0].uri);
  const backup: BookBackup = JSON.parse(raw);

  if (backup.version !== 2 || !backup.book?.title || !Array.isArray(backup.sessions)) {
    throw new Error('Invalid backup file');
  }

  // Check if a matching book already exists
  const existingBooks = getBooksByLastSession();
  const match = findMatchingBook(backup.book.title, existingBooks);

  let bookId: number;
  let status: 'merged' | 'created';

  if (match) {
    bookId = match.id;
    status = 'merged';
  } else {
    bookId = insertBook(
      {
        googleBooksId: backup.book.googleBooksId,
        title: backup.book.title,
        author: backup.book.author,
        coverUrl: backup.book.coverUrl,
        isbn: backup.book.isbn,
        description: backup.book.description,
        pageCount: backup.book.pageCount,
      },
      { title: backup.book.title, author: backup.book.author, chapter: null, blocks: [] }
    );
    status = 'created';
  }

  for (const session of backup.sessions) {
    insertReadingSessionRaw(bookId, session);
  }

  return { status, bookId, bookTitle: backup.book.title };
}
