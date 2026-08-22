export type ZedBindings = Record<string, string | number | bigint | null>

export interface ZedDb {
  query(sql: string): {
    all(params?: ZedBindings): unknown[]
    get(params?: ZedBindings): unknown
  }
  close(): void
}

export interface ZedDbFactory {
  open(path: string): ZedDb
}
