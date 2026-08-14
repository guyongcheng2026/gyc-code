// Kernel32 console-mode functions used by the Windows TUI.
// Handles are opaque: bun:ffi yields a pointer value, koffi yields a number.

export interface Win32Kernel {
  GetStdHandle(n: number): unknown
  GetConsoleMode(h: unknown, out: number[]): number
  SetConsoleMode(h: unknown, mode: number): number
  FlushConsoleInputBuffer(h: unknown): number
  SetConsoleOutputCP(cp: number): number
  GetConsoleOutputCP(): number
  SetConsoleCP(cp: number): number
  GetConsoleCP(): number
}

export interface Win32KernelLoader {
  load(): Win32Kernel | undefined
}
