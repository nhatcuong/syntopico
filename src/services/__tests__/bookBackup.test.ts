import { importBook } from '../bookBackup';
import { insertBook } from '../../db/database';
import * as FileSystem from 'expo-file-system/legacy';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn().mockResolvedValue({ canceled: false, assets: [{ uri: 'file://backup.json' }] }),
}));
jest.mock('expo-file-system/legacy', () => ({ readAsStringAsync: jest.fn() }));
jest.mock('../../db/database', () => ({
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
