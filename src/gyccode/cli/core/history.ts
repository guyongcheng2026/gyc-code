// 历史记录系统 - 使用 node:sqlite 原生驱动
// 兼容 Node 目标（dist 默认 Node 运行），避免 bun:sqlite 依赖

import { existsSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import { DatabaseSync } from "node:sqlite"
import fuzzysort from "fuzzysort"
import { HistoryEntry } from "./interactive-types"

const DB_PATH = join(homedir(), ".gyc", "history.db")
const MAX_HISTORY = 10000

export interface HistorySearchResult {
  entry: HistoryEntry
  score: number
}

interface HistoryRow {
  id: number | bigint
  session_id: string
  timestamp: number
  text: string
  type: string
}

// 历史管理器统一接口（SQLite 实装与内存回退共用）
export interface IHistoryManager {
  addUserInput(text: string): Promise<number>
  addCommand(text: string): Promise<number>
  addSlashCommand(text: string): Promise<number>
  getSessionHistory(limit?: number): Promise<HistoryEntry[]>
  search(query: string, limit?: number): Promise<HistorySearchResult[]>
  getRecent(limit?: number): Promise<HistoryEntry[]>
  getBySession(sessionId: string, limit?: number): Promise<HistoryEntry[]>
  close(): void
}

// SQLite 服务层（node:sqlite 同步驱动）
class HistoryDatabase {
  private db: DatabaseSync

  constructor() {
    const dbDir = dirname(DB_PATH)
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }
    try {
      this.db = new DatabaseSync(DB_PATH)
    } catch {
      // 只读文件系统/权限不足时回退到内存库
      this.db = new DatabaseSync(":memory:")
    }
  }

  init(): void {
    this.db.exec(`
        CREATE TABLE IF NOT EXISTS history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          timestamp INTEGER NOT NULL,
          text TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'user'
        );
        CREATE INDEX IF NOT EXISTS idx_history_session_time ON history(session_id, timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_history_text ON history(text);
      `)
  }

  private mapRow(row: HistoryRow): HistoryEntry {
    return {
      id: Number(row.id),
      sessionId: row.session_id,
      timestamp: Number(row.timestamp),
      text: row.text,
      type: row.type as HistoryEntry["type"],
    }
  }

  add(entry: Omit<HistoryEntry, "id">): number {
    const result = this.db.prepare(
      `INSERT INTO history (session_id, timestamp, text, type) VALUES (?, ?, ?, ?)`,
    ).run(entry.sessionId, entry.timestamp, entry.text, entry.type)

    return Number(result.lastInsertRowid)
  }

  getSessionHistory(sessionId: string, limit = 50): HistoryEntry[] {
    const rows = this.db.prepare(
      `SELECT id, session_id, timestamp, text, type FROM history WHERE session_id = ? ORDER BY timestamp DESC LIMIT ?`,
    ).all(sessionId, limit) as unknown as HistoryRow[]
    return rows.map(r => this.mapRow(r))
  }

  getRecent(limit = 20): HistoryEntry[] {
    const rows = this.db.prepare(
      `SELECT id, session_id, timestamp, text, type FROM history ORDER BY timestamp DESC LIMIT ?`,
    ).all(limit) as unknown as HistoryRow[]
    return rows.map(r => this.mapRow(r))
  }

  getBySession(sessionId: string, limit = 50): HistoryEntry[] {
    return this.getSessionHistory(sessionId, limit)
  }

  cleanup(): void {
    this.db.prepare(
      `DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY timestamp DESC LIMIT ?)`,
    ).run(MAX_HISTORY)
  }

  close(): void {
    try {
      this.db.close()
    } catch {
      // 已关闭则忽略
    }
  }
}

// 内存缓存包装器
export class HistoryManager implements IHistoryManager {
  private db: HistoryDatabase
  private memoryCache: HistoryEntry[] = []
  private sessionId: string
  private initialized = false

  constructor(sessionId: string) {
    this.sessionId = sessionId
    this.db = new HistoryDatabase()
  }

  async ensureInit(): Promise<void> {
    if (!this.initialized) {
      this.db.init()
      this.loadCache()
      this.initialized = true
    }
  }

  private loadCache(): void {
    this.memoryCache = this.db.getSessionHistory(this.sessionId, 1000)
  }

  async add(entry: Omit<HistoryEntry, "id">): Promise<number> {
    await this.ensureInit()
    const id = this.db.add(entry)

    this.memoryCache.unshift({ ...entry, id })
    if (this.memoryCache.length > 1000) this.memoryCache.pop()

    this.db.cleanup()
    return id
  }

  async addUserInput(text: string): Promise<number> {
    return this.add({ sessionId: this.sessionId, timestamp: Date.now(), text, type: "user" })
  }

  async addCommand(text: string): Promise<number> {
    return this.add({ sessionId: this.sessionId, timestamp: Date.now(), text, type: "command" })
  }

  async addSlashCommand(text: string): Promise<number> {
    return this.add({ sessionId: this.sessionId, timestamp: Date.now(), text, type: "slash" })
  }

  async getSessionHistory(limit = 50): Promise<HistoryEntry[]> {
    await this.ensureInit()
    return this.memoryCache.slice(0, limit).reverse()
  }

  async search(query: string, limit = 20): Promise<HistorySearchResult[]> {
    await this.ensureInit()
    if (!query.trim()) {
      return this.memoryCache.slice(0, limit).map(e => ({ entry: e, score: 0 }))
    }

    return fuzzysort
      .go(query, this.memoryCache, { keys: ["text"], threshold: -10000, limit })
      .map(r => ({ entry: r.obj, score: r.score }))
  }

  async getRecent(limit = 20): Promise<HistoryEntry[]> {
    await this.ensureInit()
    return this.db.getRecent(limit)
  }

  async getBySession(sessionId: string, limit = 50): Promise<HistoryEntry[]> {
    await this.ensureInit()
    return this.db.getBySession(sessionId, limit)
  }

  close(): void {
    this.db.close()
  }
}

// 简单的内存历史（fallback）
export class MemoryHistoryManager implements IHistoryManager {
  private history: HistoryEntry[] = []
  private sessionId: string

  constructor(sessionId: string) {
    this.sessionId = sessionId
  }

  async addUserInput(text: string): Promise<number> {
    const entry: HistoryEntry = { id: Date.now(), sessionId: this.sessionId, timestamp: Date.now(), text, type: "user" }
    this.history.unshift(entry)
    if (this.history.length > 1000) this.history.pop()
    return entry.id
  }

  async addCommand(text: string): Promise<number> {
    const entry: HistoryEntry = { id: Date.now(), sessionId: this.sessionId, timestamp: Date.now(), text, type: "command" }
    this.history.unshift(entry)
    if (this.history.length > 1000) this.history.pop()
    return entry.id
  }

  async addSlashCommand(text: string): Promise<number> {
    const entry: HistoryEntry = { id: Date.now(), sessionId: this.sessionId, timestamp: Date.now(), text, type: "slash" }
    this.history.unshift(entry)
    if (this.history.length > 1000) this.history.pop()
    return entry.id
  }

  async getSessionHistory(limit = 50): Promise<HistoryEntry[]> {
    return this.history.slice(0, limit).reverse()
  }

  async search(query: string, limit = 20): Promise<HistorySearchResult[]> {
    if (!query.trim()) return this.history.slice(0, limit).map(e => ({ entry: e, score: 0 }))
    return fuzzysort.go(query, this.history, { keys: ["text"], threshold: -10000, limit }).map(r => ({ entry: r.obj, score: r.score }))
  }

  async getRecent(limit = 20): Promise<HistoryEntry[]> {
    return this.history.slice(0, limit)
  }

  async getBySession(sessionId: string, limit = 50): Promise<HistoryEntry[]> {
    return this.history.filter(e => e.sessionId === sessionId).slice(0, limit)
  }

  close(): void {}
}

// 工厂函数
export async function createHistoryManager(sessionId: string): Promise<IHistoryManager> {
  try {
    const manager = new HistoryManager(sessionId)
    await manager.ensureInit()
    return manager
  } catch (error) {
    console.warn("[history] SQLite 初始化失败，使用内存历史:", error instanceof Error ? error.message : String(error))
    return new MemoryHistoryManager(sessionId)
  }
}