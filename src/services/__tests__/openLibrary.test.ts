import { fetchOpenLibraryMetadata } from '../openLibrary';

const doc = {
  key: '/works/OL123W', title: 'Example Book', author_name: ['Jane Author'],
  editions: { docs: [{ key: '/books/OL456M' }] },
};
function respond(data: any): Response {
  return { ok: true, json: async () => data } as Response;
}
beforeEach(() => {
  jest.useFakeTimers();
  global.fetch = jest.fn();
});
afterEach(() => jest.useRealTimers());
async function lookup(title = 'Example Book', author: string | null = 'Jane Author', isbn?: string) {
  const pending = fetchOpenLibraryMetadata(title, author, isbn);
  await jest.runAllTimersAsync();
  return pending;
}
test('retrieves matching edition and work description', async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(respond({ docs: [doc] }))
    .mockResolvedValueOnce(respond({ title: doc.title, isbn_13: ['9781234567890'], number_of_pages: 200, covers: [-1, 123] }))
    .mockResolvedValueOnce(respond({ description: { value: 'Work description' } }));
  expect(await lookup()).toEqual({
    googleBooksId: null, title: doc.title, author: 'Jane Author', isbn: '9781234567890',
    pageCount: 200, coverUrl: 'https://covers.openlibrary.org/b/id/123-L.jpg?default=false', description: 'Work description',
  });
  expect((fetch as jest.Mock).mock.calls[1][0]).toBe('https://openlibrary.org/books/OL456M.json');
});
test('rejects unrelated title or conflicting author', async () => {
  (fetch as jest.Mock).mockResolvedValue(respond({ docs: [doc] }));
  expect(await lookup('Different Title')).toBeNull();
  expect(await lookup('Example Book', 'Other Writer')).toBeNull();
});
test('empty search returns null without detail calls', async () => {
  (fetch as jest.Mock).mockResolvedValue(respond({ docs: [] }));
  expect(await lookup('Example Book', null)).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('ISBN queries use an exact identifier', async () => {
  (fetch as jest.Mock).mockResolvedValue(respond({ docs: [] }));
  await lookup('Example Book', null, '9781234567890');
  expect((fetch as jest.Mock).mock.calls[0][0]).toContain('isbn=9781234567890');
});
test('detail failures preserve the search match', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(respond({ docs: [doc] })).mockRejectedValue(new Error('503'));
  expect(await lookup()).toMatchObject({ title: doc.title, isbn: null, pageCount: null, description: null });
});
test('requests are spaced at least one second apart', async () => {
  const times: number[] = [];
  (fetch as jest.Mock).mockImplementation(async () => { times.push(Date.now()); return respond({ docs: [] }); });
  const first = fetchOpenLibraryMetadata('One', null);
  const second = fetchOpenLibraryMetadata('Two', null);
  await jest.runAllTimersAsync();
  await Promise.all([first, second]);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000);
});

test('broadens an empty author-filtered search but still checks author', async () => {
  (fetch as jest.Mock).mockResolvedValueOnce(respond({ docs: [] }))
    .mockResolvedValueOnce(respond({ docs: [{ ...doc, editions: undefined }] }))
    .mockResolvedValueOnce(respond({ description: 'Description' }));
  expect(await lookup('Example Book', 'J. Author')).toMatchObject({ title: doc.title });
  expect((fetch as jest.Mock).mock.calls[1][0]).not.toContain('&author=');
});
