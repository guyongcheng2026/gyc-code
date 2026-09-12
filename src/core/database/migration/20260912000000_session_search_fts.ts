import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"
import { SESSION_SEARCH_INDEX_STATEMENTS } from "../../session-search-index"

export default {
  id: "20260912000000_session_search_fts",
  up(tx) {
    return Effect.gen(function* () {
      for (const statement of SESSION_SEARCH_INDEX_STATEMENTS) {
        yield* tx.run(statement)
      }
    })
  },
} satisfies DatabaseMigration.Migration
