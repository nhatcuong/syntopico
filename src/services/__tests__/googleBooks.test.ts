import { fetchBookMetadata, GoogleBooksError } from '../googleBooks';
import { fetchOpenLibraryMetadata } from '../openLibrary';

jest.mock('../openLibrary', () => ({ fetchOpenLibraryMetadata: jest.fn() }));
const fallback = fetchOpenLibraryMetadata as jest.Mock;
const complete = {
  googleBooksId: 'google-id', title: 'Example Book', author: 'Jane Author',
  isbn: '9781234567890', coverUrl: 'https://cover', description: 'Description', pageCount: 200,
};
function response(items: any[] = [], status = 200): Response {
  return { ok: status === 200, status, json: async () => ({ items }) } as Response;
}
function volume(book = complete): any {
  return { id: book.googleBooksId, volumeInfo: {
    title: book.title, authors: [book.author], imageLinks: book.coverUrl ? { thumbnail: book.coverUrl } : {},
    industryIdentifiers: book.isbn ? [{ type: 'ISBN_13', identifier: book.isbn }] : [],
    description: book.description, pageCount: book.pageCount,
  } };
}
beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn();
  fallback.mockReset().mockResolvedValue(null);
});
afterEach(() => jest.useRealTimers());

test('complete Google result avoids fallback', async () => {
  (fetch as jest.Mock).mockResolvedValue(response([volume()]));
  expect(await fetchBookMetadata('Example Book', 'Jane Author')).toEqual(complete);
  expect(fallback).not.toHaveBeenCalled();
});
test('503 exhausts retries then uses Open Library', async () => {
  (fetch as jest.Mock).mockResolvedValue(response([], 503));
  fallback.mockResolvedValue({ ...complete, googleBooksId: null });
  const pending = fetchBookMetadata('Example Book', 'Jane Author');
  await jest.runAllTimersAsync();
  expect(await pending).toEqual({ ...complete, googleBooksId: null });
  expect(fetch).toHaveBeenCalledTimes(4);
});
test('network failure uses fallback', async () => {
  (fetch as jest.Mock).mockRejectedValue(new TypeError('Network failed'));
  fallback.mockResolvedValue({ ...complete, googleBooksId: null });
  expect((await fetchBookMetadata('Example Book', null))?.googleBooksId).toBeNull();
});
test('empty Google queries use fallback', async () => {
  (fetch as jest.Mock).mockResolvedValue(response());
  fallback.mockResolvedValue({ ...complete, googleBooksId: null });
  expect(await fetchBookMetadata('Example Book', 'Jane Author')).toEqual({ ...complete, googleBooksId: null });
  expect(fetch).toHaveBeenCalledTimes(2);
});
test('same ISBN fills missing fields without losing Google identity', async () => {
  fallback.mockResolvedValue({ ...complete, googleBooksId: null });
  // Google uses null for absent fields.
  (fetch as jest.Mock).mockResolvedValue(response([{ ...volume(), volumeInfo: { ...volume().volumeInfo, description: undefined } }]));
  expect(await fetchBookMetadata('Example Book', 'Jane Author')).toEqual(complete);
  expect(fallback).toHaveBeenCalledWith('Example Book', 'Jane Author', complete.isbn);
});
test('different editions are not blended', async () => {
  (fetch as jest.Mock).mockResolvedValue(response([{ id: 'google-id', volumeInfo: { title: complete.title, authors: [complete.author] } }]));
  const otherEdition = { ...complete, googleBooksId: null, isbn: '9780987654321' };
  fallback.mockResolvedValue(otherEdition);
  expect(await fetchBookMetadata('Example Book', 'Jane Author')).toEqual(otherEdition);
});
test('fallback outage preserves partial Google metadata', async () => {
  (fetch as jest.Mock).mockResolvedValue(response([{ id: 'google-id', volumeInfo: { title: complete.title } }]));
  fallback.mockRejectedValue(new Error('503'));
  expect((await fetchBookMetadata('Example Book', null))?.googleBooksId).toBe('google-id');
});
test('both providers returning no results returns null', async () => {
  (fetch as jest.Mock).mockResolvedValue(response());
  expect(await fetchBookMetadata('Unknown', null)).toBeNull();
});
test('both providers failing retains a recognized error', async () => {
  (fetch as jest.Mock).mockRejectedValue(new Error('offline'));
  fallback.mockRejectedValue(new Error('offline'));
  await expect(fetchBookMetadata('Example Book', null)).rejects.toBeInstanceOf(GoogleBooksError);
});
