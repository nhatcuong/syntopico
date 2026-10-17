import { fetchOpenLibraryMetadata } from './openLibrary';

export type BookMetadata = {
  googleBooksId: string | null;
  title: string;
  author: string | null;
  coverUrl: string | null;
  isbn: string | null;
  description: string | null;
  pageCount: number | null;
};

export class GoogleBooksError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoogleBooksError';
  }
}

const GOOGLE_BOOKS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_BOOKS_API_KEY;

async function fetchWithRetry(url: string, retries = 3): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
  if ((res.status === 429 || res.status === 503) && retries > 0) {
    await new Promise(r => setTimeout(r, 2000));
    return fetchWithRetry(url, retries - 1);
  }
  return res;
}

function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\b(a|an|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeTitle(a).split(' ').filter(Boolean));
  const wb = new Set(normalizeTitle(b).split(' ').filter(Boolean));
  if (wa.size === 0 || wb.size === 0) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size);
}

function parseItem(item: any, fallbackTitle: string): BookMetadata {
  const info = item.volumeInfo;
  const isbn =
    info.industryIdentifiers?.find(
      (id: any) => id.type === 'ISBN_13' || id.type === 'ISBN_10'
    )?.identifier ?? null;
  const rawCover: string | null =
    info.imageLinks?.thumbnail ?? info.imageLinks?.smallThumbnail ?? null;
  return {
    googleBooksId: item.id,
    title: info.title ?? fallbackTitle,
    author: info.authors?.[0] ?? null,
    coverUrl: rawCover ? rawCover.replace('http://', 'https://') : null,
    isbn,
    description: info.description ?? null,
    pageCount: info.pageCount ?? null,
  };
}

async function queryBooks(query: string, key: string): Promise<any[]> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}&maxResults=8&printType=books${key}`;
  const response = await fetchWithRetry(url);
  if (!response.ok) throw new GoogleBooksError(`Google Books API error: ${response.status}`);
  const json = await response.json();
  return json.items ?? [];
}

// Score an item for selection. Title similarity is primary; editions with a
// proper thumbnail and more ratings are preferred as tiebreakers — popular
// canonical editions tend to have better cover art than old/obscure ones.
function itemScore(item: any, queryTitle: string): number {
  const info = item.volumeInfo ?? {};
  const title = titleSimilarity(queryTitle, info.title ?? '');
  const hasThumbnail = info.imageLinks?.thumbnail ? 0.15 : 0;
  const popularity = Math.min((info.ratingsCount ?? 0) / 500, 0.1);
  return title + hasThumbnail + popularity;
}

function pickBest(items: any[], queryTitle: string): any {
  return items.reduce((best, item) =>
    itemScore(item, queryTitle) > itemScore(best, queryTitle) ? item : best
  , items[0]);
}

async function fetchGoogleBookMetadata(
  title: string,
  author: string | null
): Promise<BookMetadata | null> {
  const key = GOOGLE_BOOKS_API_KEY ? `&key=${GOOGLE_BOOKS_API_KEY}` : '';

  // Try with author filter first, fall back to title-only if it yields nothing
  const queries = author
    ? [`intitle:"${title}" inauthor:"${author}"`, `intitle:"${title}"`]
    : [`intitle:"${title}"`];

  let items: any[] = [];
  for (const q of queries) {
    items = await queryBooks(q, key);
    if (items.length > 0) break;
  }

  if (items.length === 0) return null;

  return parseItem(pickBest(items, title), title);
}

// Keep the existing entry point so every capture path gets the same fallback.
export async function fetchBookMetadata(
  title: string,
  author: string | null,
): Promise<BookMetadata | null> {
  let google: BookMetadata | null = null;
  let googleError: unknown;
  try {
    google = await fetchGoogleBookMetadata(title, author);
  } catch (error) {
    googleError = error;
  }
  const complete = google && google.author && google.coverUrl && google.isbn &&
    google.description && google.pageCount && google.pageCount > 0;
  if (complete) return google;

  try {
    const fallback = await fetchOpenLibraryMetadata(title, google?.author ?? author, google?.isbn);
    if (!fallback) {
      if (googleError) throw googleError;
      return google;
    }
    if (!google) return fallback;
    // Only merge edition-specific fields when the ISBN agrees. Otherwise choose
    // one whole record, keeping cover, ISBN and page count from the same edition.
    if (google.isbn && google.isbn === fallback.isbn) {
      return {
        ...google,
        author: google.author ?? fallback.author,
        coverUrl: google.coverUrl ?? fallback.coverUrl,
        description: google.description ?? fallback.description,
        pageCount: google.pageCount && google.pageCount > 0 ? google.pageCount : fallback.pageCount,
      };
    }
    const completeness = (book: BookMetadata) =>
      [book.author, book.coverUrl, book.isbn, book.description, book.pageCount && book.pageCount > 0]
        .filter(Boolean).length;
    return completeness(fallback) > completeness(google) ? fallback : google;
  } catch (error) {
    if (google) return google;
    // Existing callers recognize this error class and display its message.
    throw new GoogleBooksError(googleError
      ? 'Could not retrieve book metadata from Google Books or Open Library. Please try again.'
      : 'Open Library lookup failed. Please try again.');
  }
}
