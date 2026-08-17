import { Effect, Schema } from "effect"
import * as path from "path"
import * as Tool from "./tool"
import DESCRIPTION from "./notebook.txt"
import { FSUtil } from "@gyccode/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { ReadCache } from "./read-cache"
import { assertExternalDirectoryEffect } from "./external-directory"
import { EventV2Bridge } from "@/event-v2-bridge"
import { FileSystem } from "@gyccode/core/filesystem"
import { Watcher } from "@gyccode/core/filesystem/watcher"

const readCache = ReadCache()

// Jupyter notebook 类型定义（nbformat 4.x）
interface NotebookCell {
  cell_type: "code" | "markdown"
  id?: string
  source: string | string[]
  metadata?: Record<string, unknown>
  execution_count?: number | null
  outputs?: unknown[]
}

interface NotebookContent {
  nbformat: number
  nbformat_minor: number
  metadata: {
    language_info?: { name?: string }
    [key: string]: unknown
  }
  cells: NotebookCell[]
}

const EditMode = Schema.Literal("replace", "insert", "delete")
const CellType = Schema.Literal("code", "markdown")

export const Parameters = Schema.Struct({
  notebook_path: Schema.String.annotate({
    description: "The absolute path to the Jupyter notebook file to edit (must be absolute, not relative)",
  }),
  cell_id: Schema.optional(Schema.String).annotate({
    description:
      "The ID of the cell to edit. When inserting a new cell, the new cell will be inserted after the cell with this ID, or at the beginning if not specified.",
  }),
  new_source: Schema.String.annotate({ description: "The new source for the cell" }),
  cell_type: Schema.optional(CellType).annotate({
    description:
      'The type of the cell (code or markdown). If not specified, it defaults to the current cell type. If using edit_mode=insert, this is required.',
  }),
  edit_mode: Schema.optional(EditMode).annotate({
    description: "The type of edit to make (replace, insert, delete). Defaults to replace.",
  }),
})

/** 将 source 统一为字符串 */
function sourceToString(source: string | string[] | undefined): string {
  if (!source) return ""
  return Array.isArray(source) ? source.join("") : source
}

/** 将字符串转为 nbformat 要求的 source 格式（按行拆分数组） */
function stringToSource(text: string): string[] {
  if (text.length === 0) return []
  // Jupyter 按 lines 存储，每行保留换行符
  const lines = text.split("\n")
  const result: string[] = []
  for (let i = 0; i < lines.length; i++) {
    if (i < lines.length - 1) {
      result.push(lines[i] + "\n")
    } else {
      // 最后一行不加换行符
      if (lines[i].length > 0) result.push(lines[i])
    }
  }
  return result
}

/** 解析 cell_id：支持 "cell-N" 格式的数字索引 */
function parseCellId(cellId: string): number | undefined {
  const match = /^cell-(\d+)$/.exec(cellId)
  if (match) return parseInt(match[1], 10)
  return undefined
}

/** 生成随机 cell ID（nbformat 4.5+ 需要） */
function generateCellId(): string {
  return Math.random().toString(36).substring(2, 15)
}

export const NotebookEditTool = Tool.define(
  "notebook_edit",
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service
    const events = yield* EventV2Bridge.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          const filepath = path.isAbsolute(params.notebook_path)
            ? params.notebook_path
            : path.join(instance.directory, params.notebook_path)
          yield* assertExternalDirectoryEffect(ctx, filepath)

          // 验证文件扩展名
          if (path.extname(filepath) !== ".ipynb") {
            throw new Error(
              "File must be a Jupyter notebook (.ipynb file). For editing other file types, use the edit tool.",
            )
          }

          // Read-before-Edit 检查
          if (!readCache.hasRead(filepath)) {
            throw new Error(
              `File has not been read yet: ${filepath}. Read it first before writing to it.`,
            )
          }

          const exists = yield* fs.existsSafe(filepath)
          if (!exists) {
            throw new Error(`Notebook file does not exist: ${filepath}`)
          }

          const content = yield* fs.readFileString(filepath)
          let notebook: NotebookContent
          try {
            notebook = JSON.parse(content) as NotebookContent
          } catch {
            throw new Error("Notebook is not valid JSON.")
          }

          const editMode = params.edit_mode ?? "replace"

          // 验证 cell_id
          if (editMode !== "insert" && !params.cell_id) {
            throw new Error("Cell ID must be specified when not inserting a new cell.")
          }
          if (editMode === "insert" && !params.cell_type) {
            throw new Error("Cell type is required when using edit_mode=insert.")
          }

          // 查找 cell 索引
          let cellIndex: number
          if (!params.cell_id) {
            cellIndex = 0
          } else {
            // 先按 ID 查找
            cellIndex = notebook.cells.findIndex((cell) => cell.id === params.cell_id)
            // 再按 "cell-N" 格式查找
            if (cellIndex === -1) {
              const parsed = parseCellId(params.cell_id)
              if (parsed !== undefined) {
                cellIndex = parsed
              } else {
                throw new Error(`Cell with ID "${params.cell_id}" not found in notebook.`)
              }
            }
            if (editMode === "insert") {
              cellIndex += 1 // 在指定 cell 之后插入
            }
          }

          // 如果 replace 超出末尾，转为 insert
          let effectiveEditMode = editMode
          if (effectiveEditMode === "replace" && cellIndex === notebook.cells.length) {
            effectiveEditMode = "insert"
          }

          const language = notebook.metadata?.language_info?.name ?? "python"
          let newCellId: string | undefined
          const supportsCellId =
            notebook.nbformat > 4 ||
            (notebook.nbformat === 4 && notebook.nbformat_minor >= 5)
          if (supportsCellId) {
            if (effectiveEditMode === "insert") {
              newCellId = generateCellId()
            } else if (params.cell_id) {
              newCellId = params.cell_id
            }
          }

          const newSourceArray = stringToSource(params.new_source)

          if (effectiveEditMode === "delete") {
            notebook.cells.splice(cellIndex, 1)
          } else if (effectiveEditMode === "insert") {
            const newCell: NotebookCell =
              params.cell_type === "markdown"
                ? {
                    cell_type: "markdown",
                    id: newCellId,
                    source: newSourceArray,
                    metadata: {},
                  }
                : {
                    cell_type: "code",
                    id: newCellId,
                    source: newSourceArray,
                    metadata: {},
                    execution_count: null,
                    outputs: [],
                  }
            notebook.cells.splice(cellIndex, 0, newCell)
          } else {
            // replace
            const targetCell = notebook.cells[cellIndex]
            if (!targetCell) {
              throw new Error(`Cell at index ${cellIndex} does not exist in notebook.`)
            }
            targetCell.source = newSourceArray
            if (targetCell.cell_type === "code") {
              targetCell.execution_count = null
              targetCell.outputs = []
            }
            if (params.cell_type && params.cell_type !== targetCell.cell_type) {
              targetCell.cell_type = params.cell_type
              if (params.cell_type === "code") {
                targetCell.execution_count = null
                targetCell.outputs = []
              } else {
                delete targetCell.execution_count
                delete targetCell.outputs
              }
            }
          }

          const updatedContent = JSON.stringify(notebook, null, 1)
          yield* fs.writeFile(filepath, updatedContent)
          // 写入后失效缓存，确保后续读取看到新内容
          readCache.invalidate(filepath)

          yield* events.publish(FileSystem.Event.Edited, { file: filepath })
          yield* events.publish(Watcher.Event.Updated, {
            file: filepath,
            event: "change",
          })

          const modeText =
            effectiveEditMode === "replace"
              ? `Updated cell ${params.cell_id ?? cellIndex}`
              : effectiveEditMode === "insert"
                ? `Inserted cell ${newCellId ?? cellIndex}`
                : `Deleted cell ${params.cell_id ?? cellIndex}`

          return {
            title: path.relative(instance.worktree, filepath),
            metadata: {
              notebook_path: filepath,
              cell_id: newCellId ?? params.cell_id,
              cell_type: params.cell_type ?? "code",
              language,
              edit_mode: effectiveEditMode,
            },
            output: `${modeText} in ${path.basename(filepath)}`,
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)
