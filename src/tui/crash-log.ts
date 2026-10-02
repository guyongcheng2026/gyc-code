import { appendFileSync, mkdirSync } from "node:fs"
import { dirname } from "node:path"

/**
 * 同步追加一行崩溃日志。
 *
 * 崩溃路径上进程会紧接着 process.exit，异步 appendFile 尚未落盘就被抢占，
 * 导致崩溃现场（堆栈、句柄账目）全部丢失——此前多次「一开启会话就退出」正是
 * 因此查不到任何记录。故此处必须同步写；写盘本身失败也不得抛出，
 * 避免在崩溃处理里再引发二次崩溃。
 */
export function writeCrashLogSync(file: string, line: string): void {
	try {
		mkdirSync(dirname(file), { recursive: true })
		appendFileSync(file, line.endsWith("\n") ? line : `${line}\n`)
	} catch {
		// 落盘失败不阻断崩溃流程
	}
}