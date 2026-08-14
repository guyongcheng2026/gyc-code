import { dlopen, ptr } from "bun:ffi"
import type { Win32Kernel, Win32KernelLoader } from "./win32-kernel"

export const win32KernelLoader: Win32KernelLoader = {
  load() {
    try {
      const k = dlopen("kernel32.dll", {
        GetStdHandle: { args: ["i32"], returns: "ptr" },
        GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
        SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
        FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
        SetConsoleOutputCP: { args: ["u32"], returns: "i32" },
        GetConsoleOutputCP: { args: [], returns: "u32" },
        SetConsoleCP: { args: ["u32"], returns: "i32" },
        GetConsoleCP: { args: [], returns: "u32" },
      })
      const modeBuf = new Uint32Array(1)
      return {
        GetStdHandle: (n) => k.symbols.GetStdHandle(n),
        GetConsoleMode: (h, out) => {
          const r = k.symbols.GetConsoleMode(h as never, ptr(modeBuf))
          out[0] = modeBuf[0]!
          return r
        },
        SetConsoleMode: (h, m) => k.symbols.SetConsoleMode(h as never, m),
        FlushConsoleInputBuffer: (h) => k.symbols.FlushConsoleInputBuffer(h as never),
        SetConsoleOutputCP: (cp) => k.symbols.SetConsoleOutputCP(cp),
        GetConsoleOutputCP: () => k.symbols.GetConsoleOutputCP(),
        SetConsoleCP: (cp) => k.symbols.SetConsoleCP(cp),
        GetConsoleCP: () => k.symbols.GetConsoleCP(),
      }
    } catch {
      return undefined
    }
  },
}
