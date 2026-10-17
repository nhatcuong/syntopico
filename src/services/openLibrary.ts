import type { BookMetadata } from './googleBooks';

// Open Library allows one request/second for unidentified clients. Serialize
// requests, including concurrent lookups, rather than bursting detail requests.
let requests: Promise<unknown> = Promise.resolve();
let lastRequestAt = 0;
async function request(path: string): Promise<any> {
  const pending = requests.then(async () => {
    const delay = Math.max(0, 1000 - (Date.now() - lastRequestAt));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    lastRequestAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`https://openlibrary.org${path}`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Open Library API error: ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  });
  requests = pending.catch(() => undefined);
  return pending;
}

function words(value: string): string[] {
  return value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter(word => word && !['a', 'an', 'the'].includes(word));
}

function similarity(a: string, b: string): number {
  const left = new Set(words(a));
  const right = new Set(words(b));
  if (!left.size || !right.size) return 0;
  return [...left].filter(word => right.has(word)).length / Math.max(left.size, right.size);
}

function description(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  if (value && typeof value === 'object' && 'value' in value) {
    return typeof value.value === 'string' ? value.value || null : null;
  }
  return null;
}

export async function fetchOpenLibraryMetadata(
  title: string,
  author: string | null,
  isbn: string | null = null,
): Promise<BookMetadata | null> {
  const query = isbn ? `isbn=${encodeURIComponent(isbn)}`
    : `title=${encodeURIComponent(title)}${author ? `&author=${encodeURIComponent(author)}` : ''}`;
  const fields = '&limit=8&fields=key,title,author_name,editions,editions.key,editions.title';
  let result = await request(`/search.json?${query}${fields}`);
  // Spoken author names often differ from catalog names (Don vs Donald).
  // Broaden retrieval, then retain the author check below before accepting it.
  if (!isbn && author && Array.isArray(result.docs) && result.docs.length === 0) {
    result = await request(`/search.json?title=${encodeURIComponent(title)}${fields}`);
  }
  if (!Array.isArray(result.docs)) throw new Error('Invalid Open Library search response');
  // Search results are works. Use the selected edition for ISBN/pages/cover,
  // never a random ISBN from the work's aggregated list of editions.
  const candidates = result.docs.filter((item: any) =>
    typeof item.title === 'string' && (isbn || (
      similarity(title, item.title) >= 0.7 &&
      (!author || item.author_name?.some((name: string) => similarity(author, name) >= 0.5))
    ))
  );
  candidates.sort((a: any, b: any) => similarity(title, b.title) - similarity(title, a.title));
  const match = candidates[0];
  if (!match) return null;
  const metadata: BookMetadata = {
    googleBooksId: null,
    title: match.title,
    author: match.author_name?.[0] ?? author,
    coverUrl: null,
    isbn: null,
    description: null,
    pageCount: null,
  };
  const editionKey = match.editions?.docs?.[0]?.key;
  if (typeof editionKey === 'string' && /^\/books\/OL\d+M$/.test(editionKey)) {
    try {
      const edition = await request(`${editionKey}.json`);
      metadata.title = edition.title ?? metadata.title;
      metadata.isbn = edition.isbn_13?.[0] ?? edition.isbn_10?.[0] ?? null;
      metadata.pageCount = edition.number_of_pages > 0 ? edition.number_of_pages : null;
      metadata.description = description(edition.description);
      const cover = edition.covers?.find((id: number) => id > 0);
      metadata.coverUrl = cover ? `https://covers.openlibrary.org/b/id/${cover}-L.jpg?default=false` : null;
    } catch {
      // Preserve a valid search match when optional detail lookup fails.
    }
  }
  const workKey = match.key?.startsWith('/works/') ? match.key : `/works/${match.key}`;
  if (!metadata.description && /^\/works\/OL\d+W$/.test(workKey)) {
    try {
      const work = await request(`${workKey}.json`);
      metadata.description = description(work.description);
    } catch {
      // Work descriptions are optional enrichment.
    }
  }
  return metadata;
}
