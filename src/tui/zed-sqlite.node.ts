import { DatabaseSync } from "node:sqlite"
import type { ZedBindings, ZedDb, ZedDbFactory } from "./zed-sqlite"

export const zedSqlite: ZedDbFactory = {
  open(path) {
    const db = new DatabaseSync(path, { readOnly: true })
    return {
      query(sql) {
        const stmt = db.prepare(sql) as { all(b?: unknown): unknown[]; get(b?: unknown): unknown }
        return {
          all: (p?: ZedBindings) => (p === undefined ? db.prepare(sql).all() : stmt.all(p)),
          get: (p?: ZedBindings) => (p === undefined ? db.prepare(sql).get() : stmt.get(p)),
        }
      },
      close: () => db.close(),
    }
  },
}
