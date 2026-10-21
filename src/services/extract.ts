import { NoteBlock } from '../types/note';

const ANTHROPIC_API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_API_KEY;

export type ExtractedNote = {
  title: string | null;
  author: string | null;
  chapter: string | null;
  blocks: NoteBlock[];
};

export class ExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractError';
  }
}

const MIN_MAX_TOKENS = 512;
const MAX_MAX_TOKENS = 4096;

// Rough token estimate — good enough for sizing an output budget, not for billing.
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Output is mostly a restructuring of the input (quotes near-verbatim, thoughts
// cleaned up but similar length) plus fixed JSON overhead per block, so it
// scales with input size. Floored/capped to bound both ends.
function computeMaxTokens(inputText: string): number {
  const estimated = Math.round(estimateTokens(inputText) * 1.4 + 300);
  return Math.min(MAX_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, estimated));
}

async function callClaudeTool(
  maxTokens: number,
  tool: Record<string, any>,
  userMessage: string
): Promise<{ input: any; truncated: boolean }> {
  if (!ANTHROPIC_API_KEY || ANTHROPIC_API_KEY === 'your_anthropic_api_key_here') {
    throw new ExtractError('Anthropic API key not set in .env');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-6',
      max_tokens: maxTokens,
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!response.ok) {
    throw new ExtractError(`Claude API error: ${response.status}`);
  }

  const json = await response.json();
  const truncated = json.stop_reason === 'max_tokens';
  const toolUse = json.content?.find((b: any) => b.type === 'tool_use');

  if (!toolUse) {
    if (truncated) return { input: null, truncated: true };
    throw new ExtractError('No structured output from Claude');
  }

  return { input: toolUse.input, truncated };
}

// Sizes the budget from the input, and if the response still got cut off,
// retries once with a generous fixed budget. A truncated response is never
// trusted even if it looks structurally valid — it may be missing content
// that didn't fit, so on repeated truncation we fail loudly rather than
// silently persist an incomplete note.
async function callClaudeToolWithRetry(
  tool: Record<string, any>,
  userMessage: string,
  sizingText: string
): Promise<any> {
  const first = await callClaudeTool(computeMaxTokens(sizingText), tool, userMessage);
  if (!first.truncated && first.input) return first.input;

  const retry = await callClaudeTool(MAX_MAX_TOKENS, tool, userMessage);
  if (!retry.truncated && retry.input) return retry.input;

  throw new ExtractError('Claude output was truncated even after retry');
}

function assertBlocks(blocks: unknown): asserts blocks is NoteBlock[] {
  if (!Array.isArray(blocks)) {
    throw new ExtractError('Claude returned malformed note blocks');
  }
}

const BLOCKS_SCHEMA = {
  type: 'array',
  description:
    'Ordered list of note blocks. ' +
    'A "quote" block is text from the book itself — words the author wrote, cited by the user. ' +
    'Signals: explicit markers ("quote...end quote", "open quote...close quote"), or phrases like "the author writes", "there\'s a line that goes", "he says", "she argues". ' +
    'Paraphrases ("the author argues that...") are thoughts, not quotes — only use quote when the user appears to be citing the actual words. ' +
    'A "thought" block is the user\'s own reaction, reflection, or commentary. ' +
    'When in doubt, use thought.',
  items: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['thought', 'quote'] },
      text: { type: 'string', description: 'The content of the block, cleaned up from spoken language but preserving meaning.' },
      location: {
        type: ['string', 'null'],
        description: 'Page, location, or percentage if mentioned near the quote (e.g. "page 25", "loc 4521"). null for thought blocks.',
      },
    },
    required: ['type', 'text', 'location'],
  },
};

export async function extractNoteOnly(transcript: string, bookTitle: string, bookAuthor: string | null): Promise<{ chapter: string | null; blocks: NoteBlock[] }> {
  const userMessage = `I just finished a reading session of "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}, and here's my note:\n\n"${transcript}"`;

  const tool = {
    name: 'extract_reading_note',
    description: 'Extract a clean note and optional chapter reference from a reading transcript.',
    input_schema: {
      type: 'object',
      properties: {
        chapter: {
          type: ['string', 'null'],
          description: 'Chapter or section reference if mentioned (e.g. "chapter 3", "part 2"), otherwise null.',
        },
        blocks: BLOCKS_SCHEMA,
      },
      required: ['chapter', 'blocks'],
    },
  };

  const input = await callClaudeToolWithRetry(tool, userMessage, transcript);
  assertBlocks(input.blocks);
  return { chapter: input.chapter ?? null, blocks: input.blocks };
}

export async function amendNote(existingBlocks: NoteBlock[], amendTranscript: string, bookTitle: string, bookAuthor: string | null): Promise<NoteBlock[]> {
  const existingText = existingBlocks
    .map((b, i) => {
      const loc = b.type === 'quote' && b.location ? ` [${b.location}]` : '';
      return `[${i + 1}] (${b.type}) ${b.text}${loc}`;
    })
    .join('\n');

  const userMessage = `I'm reading "${bookTitle}"${bookAuthor ? ` by ${bookAuthor}` : ''}. Here is a note I recorded earlier:\n\n${existingText}\n\nI'd like to amend it. Here is what I just said:\n\n"${amendTranscript}"\n\nApply my amendment and return the complete updated note.`;

  const tool = {
    name: 'amend_reading_note',
    description: 'Apply a spoken amendment to an existing reading note and return the complete updated blocks.',
    input_schema: {
      type: 'object',
      properties: {
        blocks: {
          type: 'array',
          description:
            'The complete updated note as an ordered list of blocks. ' +
            'Apply the amendment as follows: ' +
            '(1) If the user corrects a word or phrase (e.g. "I said metrics not matrix"), find and fix it in the relevant block. ' +
            '(2) If the user adds new thoughts, append them as new thought blocks. ' +
            '(3) If the user amends a specific sentence or idea, update the relevant block in place. ' +
            'Preserve all unchanged blocks exactly. ' +
            'Only use type "quote" if the block was already a quote or the amendment explicitly introduces quoted text.',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: ['thought', 'quote'] },
              text: { type: 'string' },
              location: { type: ['string', 'null'] },
            },
            required: ['type', 'text', 'location'],
          },
        },
      },
      required: ['blocks'],
    },
  };

  const input = await callClaudeToolWithRetry(tool, userMessage, existingText + '\n' + amendTranscript);
  assertBlocks(input.blocks);
  return input.blocks;
}

export async function extractBookInfo(transcript: string): Promise<ExtractedNote> {
  const userMessage = `I just finished a reading session, and here's my note:\n\n"${transcript}"`;

  const tool = {
    name: 'extract_reading_note',
    description: 'Extract structured book information from a reading note transcript.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: ['string', 'null'],
          description:
            'The book title — return it if the speaker states it directly, or if it can be confidently inferred from the author\'s name plus enough description to know which specific book they mean (e.g. "Kahneman\'s book about thinking fast and slow" clearly means Thinking, Fast and Slow). ' +
            'Return null if the transcript doesn\'t give enough to identify a specific book: no title, and no author with identifying detail. This includes off-topic speech, filler ("thank you", "okay"), and reading commentary that only gives a chapter number or reaction without naming or otherwise identifying the book. ' +
            'Do not guess a title from an unrelated stray word — a transcript that is just "silence" or "thank you" is not a book called Silence or Thank You. ' +
            'When unsure, prefer null over a guess.',
        },
        author: {
          type: ['string', 'null'],
          description: 'Author name if mentioned, otherwise null.',
        },
        chapter: {
          type: ['string', 'null'],
          description: 'Chapter or section reference if mentioned (e.g. "chapter 3", "part 2"), otherwise null.',
        },
        blocks: BLOCKS_SCHEMA,
      },
      required: ['title', 'author', 'chapter', 'blocks'],
    },
  };

  const input = await callClaudeToolWithRetry(tool, userMessage, transcript);
  assertBlocks(input.blocks);
  return input as ExtractedNote;
}
