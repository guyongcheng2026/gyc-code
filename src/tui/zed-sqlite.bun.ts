import { Database } from "bun:sqlite"
import type { ZedBindings, ZedDb, ZedDbFactory } from "./zed-sqlite"

export const zedSqlite: ZedDbFactory = {
  open(path) {
    const db = new Database(path, { readonly: true })
    return {
      query(sql) {
        const stmt = db.query(sql) as { all(b?: unknown): unknown[]; get(b?: unknown): unknown }
        return {
          all: (p?: ZedBindings) => (p === undefined ? db.query(sql).all() : stmt.all(p)),
          get: (p?: ZedBindings) => (p === undefined ? db.query(sql).get() : stmt.get(p)),
        }
      },
      close: () => db.close(),
    }
  },
}
