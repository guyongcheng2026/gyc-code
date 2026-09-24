/**
 * Model-ID wire helpers, kept at the `llm` layer so both the provider
 * (wire-id resolution) and the session (prompt/compaction decisions) can use
 * them without introducing a session→provider or provider→session edge.
 */

/** True when the model id carries an explicit `[1m]` opt-in suffix (case-insensitive). */
export function parse1mSuffix(modelId: string): boolean {
  return /\[1m\]\s*$/i.test(modelId)
}

/** Strip a trailing [1m] opt-in suffix from a model id so it never reaches the wire. */
export function strip1mSuffix(modelId: string): string {
  return modelId.replace(/\[1m\]\s*$/i, "").trimEnd()
}
