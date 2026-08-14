import koffi from "koffi"
import type { Win32Kernel, Win32KernelLoader } from "./win32-kernel"

export const win32KernelLoader: Win32KernelLoader = {
  load() {
    try {
      const lib = koffi.load("kernel32.dll")
      const GetStdHandle = lib.func("void * GetStdHandle(int32_t nStdHandle)")
      const GetConsoleMode = lib.func("int32_t __stdcall GetConsoleMode(void * h, _Out_ uint32_t * mode)")
      const SetConsoleMode = lib.func("int32_t __stdcall SetConsoleMode(void * h, uint32_t mode)")
      const FlushConsoleInputBuffer = lib.func("int32_t __stdcall FlushConsoleInputBuffer(void * h)")
      const SetConsoleOutputCP = lib.func("int32_t __stdcall SetConsoleOutputCP(uint32_t cp)")
      const GetConsoleOutputCP = lib.func("uint32_t __stdcall GetConsoleOutputCP()")
      const SetConsoleCP = lib.func("int32_t __stdcall SetConsoleCP(uint32_t cp)")
      const GetConsoleCP = lib.func("uint32_t __stdcall GetConsoleCP()")
      return {
        GetStdHandle: (n) => Number(GetStdHandle(n)),
        GetConsoleMode: (h, out) => {
          const mode = [0]
          const r = GetConsoleMode(h as number, mode)
          out[0] = mode[0]!
          return r
        },
        SetConsoleMode: (h, m) => SetConsoleMode(h as number, m),
        FlushConsoleInputBuffer: (h) => FlushConsoleInputBuffer(h as number),
        SetConsoleOutputCP: (cp) => SetConsoleOutputCP(cp),
        GetConsoleOutputCP: () => GetConsoleOutputCP(),
        SetConsoleCP: (cp) => SetConsoleCP(cp),
        GetConsoleCP: () => GetConsoleCP(),
      }
    } catch {
      return undefined
    }
  },
}
