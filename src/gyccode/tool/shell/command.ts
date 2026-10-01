import { Shell } from "@gyccode/core/shell"

export type Resolved = {
  file: string
  args: string[]
  /** 是否交给系统 shell 解析整条命令（cmd.exe / bash / zsh 等） */
  useShell: boolean
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    detached: boolean
  }
}

/**
 * 把一条命令解析成可执行文件 + 参数，供前台（Effect ChildProcess）与
 * 后台（node child_process）两条路径共用，避免两处各自实现一遍平台差异。
 */
export function resolve(
  shell: string,
  command: string,
  cwd: string,
  env: NodeJS.ProcessEnv,
  detached: boolean,
): Resolved {
  if (process.platform === "win32" && Shell.ps(shell)) {
    return {
      file: shell,
      args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
      useShell: false,
      options: { cwd, env, detached },
    }
  }

  return {
    file: command,
    args: [],
    useShell: true,
    options: { cwd, env, detached },
  }
}