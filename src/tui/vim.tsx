import { CliRenderEvents, InputRenderable, TextareaRenderable, type Renderable } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { GYCCODE_BASE_MODE, useBindings } from "./keymap"
import { useKV } from "./context/kv"

export const VIM_MODE_KEY = "vim_mode_enabled"

type VimState = "insert" | "normal"

function isManagedTextarea(target: Renderable | null | undefined) {
  return target instanceof TextareaRenderable && !(target instanceof InputRenderable)
}

/**
 * Vim 键绑定层：消费 KV `vim_mode_enabled`，在受管 textarea 上提供 NORMAL/INSERT 双模式编辑。
 *
 * 机制：keymap 绑定命中后默认 preventDefault，textarea 的 handleKeyPress 被跳过，
 * 因此 NORMAL 模式下单字符按键（h/j/k/l 等）执行光标命令而不插入字符；
 * INSERT 模式下本层仅接管 escape（切换到 NORMAL），其余按键照常插入。
 */
export function useVimKeymap() {
  const renderer = useRenderer()
  const kv = useKV()

  const [vimState, setVimState] = createSignal<VimState>("insert")
  const [textareaFocused, setTextareaFocused] = createSignal(false)

  // 跟踪受管 textarea 焦点（FOCUSED_EDITOR 仅在编辑器获得/失去焦点时触发）
  createEffect(() => {
    const handler = (current: Renderable | null) => setTextareaFocused(isManagedTextarea(current))
    handler(renderer.currentFocusedEditor)
    renderer.on(CliRenderEvents.FOCUSED_EDITOR, handler)
    onCleanup(() => renderer.off(CliRenderEvents.FOCUSED_EDITOR, handler))
  })

  // vim 关闭时复位到 INSERT，保证下次开启从可打字状态开始
  createEffect(() => {
    if (kv.get(VIM_MODE_KEY, false) === true) return
    setVimState("insert")
  })

  const inNormal = () => kv.get(VIM_MODE_KEY, false) === true && vimState() === "normal" && textareaFocused()
  const inInsert = () => kv.get(VIM_MODE_KEY, false) === true && vimState() === "insert" && textareaFocused()

  const focusedEditor = () => {
    const target = renderer.currentFocusedEditor
    if (target && !target.isDestroyed && isManagedTextarea(target)) return target
    return undefined
  }

  const enterInsert = () => {
    setVimState("insert")
    return true
  }

  // NORMAL 模式：移动/编辑 + 进入 INSERT
  useBindings(() => ({
    mode: GYCCODE_BASE_MODE,
    enabled: inNormal(),
    priority: 10,
    commands: [
      { name: "vim.insert", desc: "光标前进入输入", run: () => enterInsert() },
      {
        name: "vim.append",
        desc: "光标后进入输入",
        run: () => {
          focusedEditor()?.moveCursorRight()
          return enterInsert()
        },
      },
      {
        name: "vim.insert.line.start",
        desc: "行首进入输入",
        run: () => {
          focusedEditor()?.gotoLineHome()
          return enterInsert()
        },
      },
      {
        name: "vim.append.line.end",
        desc: "行尾进入输入",
        run: () => {
          focusedEditor()?.gotoLineEnd()
          return enterInsert()
        },
      },
      {
        name: "vim.open.below",
        desc: "下方新起一行进入输入",
        run: () => {
          const target = focusedEditor()
          if (target) {
            target.gotoLineEnd()
            target.newLine()
          }
          return enterInsert()
        },
      },
      {
        name: "vim.open.above",
        desc: "上方新起一行进入输入",
        run: () => {
          const target = focusedEditor()
          if (target) {
            target.gotoLineHome()
            target.newLine()
            target.moveCursorUp()
          }
          return enterInsert()
        },
      },
      { name: "vim.cancel", desc: "取消当前操作", run: () => true },
    ],
    bindings: [
      { key: "h", cmd: "input.move.left", desc: "Vim 左移" },
      { key: "l", cmd: "input.move.right", desc: "Vim 右移" },
      { key: "k", cmd: "input.move.up", desc: "Vim 上移" },
      { key: "j", cmd: "input.move.down", desc: "Vim 下移" },
      { key: "w", cmd: "input.word.forward", desc: "Vim 下一词" },
      { key: "b", cmd: "input.word.backward", desc: "Vim 上一词" },
      { key: "0", cmd: "input.line.home", desc: "Vim 行首" },
      { key: "$", cmd: "input.line.end", desc: "Vim 行尾" },
      { key: "g,g", cmd: "input.buffer.home", desc: "Vim 缓冲区首" },
      { key: "G", cmd: "input.buffer.end", desc: "Vim 缓冲区尾" },
      { key: "x", cmd: "input.delete", desc: "Vim 删字符" },
      { key: "d,d", cmd: "input.delete.line", desc: "Vim 删行" },
      { key: "D", cmd: "input.delete.to.line.end", desc: "Vim 删至行尾" },
      { key: "u", cmd: "input.undo", desc: "Vim 撤销" },
      { key: "ctrl+r", cmd: "input.redo", desc: "Vim 重做" },
      { key: "i", cmd: "vim.insert", desc: "进入输入模式" },
      { key: "a", cmd: "vim.append", desc: "追加进入输入" },
      { key: "I", cmd: "vim.insert.line.start", desc: "行首进入输入" },
      { key: "A", cmd: "vim.append.line.end", desc: "行尾进入输入" },
      { key: "o", cmd: "vim.open.below", desc: "下方新行输入" },
      { key: "O", cmd: "vim.open.above", desc: "上方新行输入" },
      { key: "escape", cmd: "vim.cancel", desc: "取消挂起操作" },
    ],
  }))

  // INSERT 模式：仅接管 escape（切换到 NORMAL），其余按键由默认 input 层处理
  useBindings(() => ({
    mode: GYCCODE_BASE_MODE,
    enabled: inInsert(),
    priority: 10,
    commands: [
      {
        name: "vim.normal",
        desc: "退出输入模式",
        run: () => {
          const target = focusedEditor()
          // vim 惯例：退出 INSERT 时光标左移一格（行首除外）
          if (target && target.logicalCursor.col > 0) target.moveCursorLeft()
          setVimState("normal")
          return true
        },
      },
    ],
    bindings: [{ key: "escape", cmd: "vim.normal", desc: "进入 NORMAL 模式" }],
  }))

  return {
    vimState,
    enabled: () => kv.get(VIM_MODE_KEY, false) === true,
  }
}
