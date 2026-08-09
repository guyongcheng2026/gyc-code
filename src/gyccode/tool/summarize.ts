/**
 * Cheap-model summarization for large tool outputs (e.g. WebFetch pages).
 * The summarizer is injectable so the pure logic is unit-testable; the real
 * implementation wires a small/cheap model (aligned with Claude Code's use of
 * Haiku for WebFetch summarization).
 */

/** Default threshold: content above this many chars is worth summarizing. */
export const DEFAULT_SUMMARIZE_THRESHOLD = 100_000
/** Bounded slice of the raw content handed to the summarizer. */
export const MAX_SUMMARIZE_INPUT_CHARS = 80_000

export type Summarizer = (text: string) => Promise<string>

/** True when content exceeds the threshold and should be summarized. */
export function shouldSummarize(text: string, threshold = DEFAULT_SUMMARIZE_THRESHOLD): boolean {
  return text.length > threshold
}

/**
 * Summarize large text with an injected summarizer. Only a bounded slice of the
 * input is sent (the head, which typically contains the page's meaningful
 * content). Falls back to the raw text if the summarizer throws.
 */
export async function summarizeText(
  text: string,
  summarizer: Summarizer,
  threshold = DEFAULT_SUMMARIZE_THRESHOLD,
): Promise<string> {
  if (!shouldSummarize(text, threshold)) return text
  const slice = text.slice(0, MAX_SUMMARIZE_INPUT_CHARS)
  try {
    return await summarizer(slice)
  } catch {
    return text
  }
}
