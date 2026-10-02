export * as Browser from "./browser";

// 无头浏览器（P2-2）
//
// 不引 playwright/puppeteer，改为拉起本机已装的 Chromium 系浏览器并走 CDP。
// 这么做有两个理由：一是仓库一直守「零新增依赖」，二是 playwright 会连带
// 下载上百 MB 的 Chromium，与本机已装浏览器的事实重复。
//
// 代价要说清楚：需要用户机器上有 Edge/Chrome/Chromium。找不到时 locate 返回
// undefined，由调用方给出可执行的提示，而不是悄悄降级成「假装截了图」。
import path from "path";

/** 各平台下 Chromium 系浏览器的常见安装位置，按优先级排列 */
export function candidates(
  platform: NodeJS.Platform = process.platform,
): ReadonlyArray<string> {
  if (platform === "win32")
    return [
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
      "C:/Program Files/Google/Chrome/Application/chrome.exe",
      "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    ];
  if (platform === "darwin")
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  return [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/microsoft-edge",
  ];
}

/**
 * 解析 CDP 的 http://127.0.0.1:<port>/json 列表，取出可用的 WebSocket 端点。
 * 优先 browser 级（可以新建 target），只有 page 级时退回它。
 */
export function parseEndpoint(list: string): string | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(list);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed)) return undefined;
  const urls = parsed
    .map(
      (item) =>
        (item as { webSocketDebuggerUrl?: unknown }).webSocketDebuggerUrl,
    )
    .filter((value): value is string => typeof value === "string");
  return urls.find((url) => url.includes("/devtools/browser/")) ?? urls[0];
}

/** 清洗 URL 得出截图文件名：只保留安全字符，长度封顶 */
export function screenshotName(url: string): string {
  let base = url;
  try {
    const parsed = new URL(url);
    base = `${parsed.host}${parsed.pathname}`;
  } catch {
    base = url;
  }
  const cleaned = base
    .replace(/^https?:\/\//, "")
    .replace(/[?#].*$/, "")
    .replace(/[:/\\]+/g, "_")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "")
    .toLowerCase();
  const stem = (cleaned.length === 0 ? "screenshot" : cleaned).slice(0, 76);
  return `${stem}.png`;
}

/**
 * 定位可用的浏览器可执行文件。注入 exists 便于测试；生产传 node:fs 的 existsSync。
 *
 * 注意「存在」不等于「能用」：本机实测 Chrome 存在但启动即失败
 * （side-by-side configuration is incorrect），同一台机器上 Edge 正常。
 * 所以 locate 只做初筛，真正的可用性由 capture 逐个候选试启动来兜底。
 */
export function locate(
  explicit: string | undefined,
  paths: ReadonlyArray<string>,
  exists: (candidate: string) => boolean = (candidate) => {
    try {
      return require("fs").existsSync(candidate) as boolean;
    } catch {
      return false;
    }
  },
): string | undefined {
  if (explicit !== undefined && explicit.length > 0) return explicit;
  return paths.find((candidate) => exists(candidate));
}

/** 返回全部存在的候选，按优先级排列，供逐个试启动使用 */
export function locateAll(
  paths: ReadonlyArray<string>,
  exists: (candidate: string) => boolean = (candidate) => {
    try {
      return require("fs").existsSync(candidate) as boolean;
    } catch {
      return false;
    }
  },
): ReadonlyArray<string> {
  return paths.filter(exists);
}

export const USER_DATA_DIR = "browser-profile";
export const DEBUG_PORT = 9222;
export const DEFAULT_TIMEOUT = 30_000;
export const MAX_VIEWPORT_WIDTH = 2560;

/** 拉起浏览器的启动参数：独立 profile 目录避免污染用户日常配置 */
export const launchArgs = (
  userDataDir: string,
  port: number,
): ReadonlyArray<string> => [
  "--headless=new",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-gpu",
  "--hide-scrollbars",
  "--disable-extensions",
  "--disable-background-networking",
  "about:blank",
];

/** CDP 会话：一次连接，按 id 配对响应 */
export class Session {
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  private nextId = 1;
  private socket: WebSocket | undefined;

  constructor(private readonly socket_: WebSocket) {
    this.socket = socket_;
    this.socket_.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data)) as {
        id?: number;
        result?: unknown;
        error?: { message: string };
      };
      if (data.id === undefined) return;
      const waiter = this.pending.get(data.id);
      if (!waiter) return;
      this.pending.delete(data.id);
      if (data.error) waiter.reject(new Error(data.error.message));
      else waiter.resolve(data.result);
    });
  }

  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<unknown> {
    const id = this.nextId++;
    const payload: Record<string, unknown> = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.send(JSON.stringify(payload));
    });
  }

  close() {
    try {
      this.socket?.close();
    } catch {
      // 关闭失败不影响调用方：进程回收已经在外层做了
    }
  }
}

/** 等待 CDP 的 /json 列表就绪。浏览器起来到能连上有几秒延迟，这里轮询。 */
export async function waitForEndpoint(
  port: number,
  deadline: number,
): Promise<string> {
  for (;;) {
    try {
      // /json/version 返回的是 browser 级端点（对象），不是 /json 的页面列表（数组）。
      // 必须读 webSocketDebuggerUrl：只有 browser 级端点才能 Target.createTarget 建新页面，
      // 而 /json 只会列出当前已开的页面 target。
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      const body = (await response.json()) as {
        webSocketDebuggerUrl?: unknown;
      };
      if (
        typeof body.webSocketDebuggerUrl === "string" &&
        body.webSocketDebuggerUrl.length > 0
      )
        return body.webSocketDebuggerUrl;
    } catch {
      // 端口还没起来，继续等
    }
    const left = deadline - Date.now();
    if (left <= 0)
      throw new Error(
        `浏览器在 ${Math.max(0, Math.round(left / 1000))}s 内未就绪`,
      );
    await new Promise((r) => setTimeout(r, 200));
  }
}

export const screenshotDir = (dataRoot: string) =>
  path.join(dataRoot, "screenshots");
