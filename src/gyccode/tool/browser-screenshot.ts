// 无头浏览器截图工具（P2-2）
//
// 补的是「打开页面 → 渲染 → 截图 → 交给模型看」这条闭环。现有 webfetch
// 只能拿源码/正文，DOM 之外的东西（布局、字体、Canvas、响应式断点、动画
// 后的样子）一概看不到，所以模型无法自检 UI。
//
// 路线上没用 playwright/puppeteer：仓库守零新增依赖，而 Node 自带 WebSocket
// 足以跟 CDP 说话。代价是需要本机装有 Edge/Chrome/Chromium；找不到时明确
// 报错，不假装截了图。
import { spawn, type ChildProcess } from "child_process";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";
import { Effect, Schema } from "effect";
import { Browser } from "./browser";
import { Tool } from "@/tool/tool";
import { Global } from "@core/global";

const DESCRIPTION = `打开网页并截图，把渲染后的画面交给模型。

用途是让模型自检 UI：布局错位、字体缺失、响应式断点不对、Canvas/SVG 画错、
资源 404 导致的大片空白——这些只看源码是发现不了的。

实现说明（影响模型如何解读结果）：
- 使用本机已安装的 Edge/Chrome/Chromium，通过 CDP 驱动，全程无头，不打开窗口
- 返回的是真实渲染结果，不是对页面的推测。截图里没有的东西就是没渲染出来
- 默认只截视口内可见区域；需要整页请传 full_page
- 页面若需要登录，本工具不会替你登录，会截到登录页或空白

结果来源与局限：截图是渲染后的像素，不含 DOM 结构。要分析结构请配合 fetch 或 read。

限制：
- 需要本机装有 Chromium 系浏览器；没有会直接报错而不是降级
- 不执行任何交互（点击、滚动到指定元素、填表单），只做「打开 → 等 → 截」
- 截图落盘在 <data>/screenshots/，同时作为图片附件返回给模型
`;

export const Parameters = Schema.Struct({
  url: Schema.String.annotate({
    description: "要截图的网页 URL，必须是 http:// 或 https://",
  }),
  width: Schema.optional(Schema.Number).annotate({
    description: "视口宽度（像素），默认 1288，最大 2560",
  }),
  height: Schema.optional(Schema.Number).annotate({
    description: "视口高度（像素），默认 900",
  }),
  full_page: Schema.optional(Schema.Boolean).annotate({
    description: "是否截整页（超出视口的部分也截）。默认只截视口。",
  }),
  wait: Schema.optional(Schema.Number).annotate({
    description:
      "导航完成后额外等待的毫秒数，给前端动画/懒加载留时间。默认 800",
  }),
  timeout: Schema.optional(Schema.Number).annotate({
    description: "整体超时（秒），默认 30",
  }),
});

const DEFAULT_WIDTH = 1288;
const DEFAULT_HEIGHT = 900;
const DEFAULT_WAIT = 800;
const MAX_WAIT = 10_000;

/** 打开目标页并截图，返回 PNG 字节与页面标题 */
/**
 * 逐个候选启动浏览器，返回第一个真正能起 CDP 的。
 *
 * 为什么不能只按「文件存在」挑：实测本机 chrome.exe 存在却启动即失败
 * （版本目录被清空，side-by-side configuration is incorrect），而 Edge 正常。
 * 只用 locate() 会选中坏的那个并一直超时。逐个试启动才能自动退到可用的浏览器。
 */
async function launchAny(
  executables: ReadonlyArray<string>,
  profile: string,
  port: number,
  deadline: number,
): Promise<{ child: ChildProcess; endpoint: string; used: string }> {
  const failures: string[] = [];
  for (const [index, executable] of executables.entries()) {
    const child = spawn(executable, Browser.launchArgs(profile, port), {
      stdio: "ignore",
      detached: false,
    });
    // 每个候选只分到「剩余时间 ÷ 剩余候选数」。
    // 除以 1 等于把整份剩余时间给每个候选，候选有 N 个时整体超时被放大到 N 倍，
    // 首个候选坏掉时用户要等 N 倍时长才看到失败。
    const remainingCandidates = Math.max(1, executables.length - index);
    const slice =
      Date.now() + Math.max(5_000, Math.floor((deadline - Date.now()) / remainingCandidates));
    try {
      const endpoint = await Browser.waitForEndpoint(port, slice);
      return { child, endpoint, used: executable };
    } catch (cause) {
      child.kill();
      failures.push(
        `${executable}: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
  }
  throw new Error(`所有候选浏览器均无法启动：\n${failures.join("\n")}`);
}

async function capture(
  executables: ReadonlyArray<string>,
  url: string,
  options: {
    width: number;
    height: number;
    fullPage: boolean;
    wait: number;
    timeout: number;
    dataRoot: string;
  },
): Promise<{ bytes: Buffer; title: string; file: string; fullPage: boolean }> {
  // 端口与 profile 目录都带随机成分：崩溃或超时退出时上一次留下的 profile 会一直堆积，
// 而残留的浏览器实例仍占着同一个调试端口，下次可能直接连上旧实例（页面、cookie 全是上次的）。
  // 因此每次都用一次性目录，结束后在 finally 里连目录一起清掉。
  const port = Browser.DEBUG_PORT + Math.floor(Math.random() * 800);
  const profile = path.join(
    options.dataRoot,
    Browser.USER_DATA_DIR,
    `${port}-${process.pid}-${Date.now()}`,
  );
  await mkdir(profile, { recursive: true });

  const deadline = Date.now() + options.timeout;
  const { child, endpoint } = await launchAny(
    executables,
    profile,
    port,
    deadline,
  );

  try {
    const socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener("open", () => resolve(), { once: true });
      socket.addEventListener(
        "error",
        () => reject(new Error(`无法连接浏览器 CDP 端点：${endpoint}`)),
        { once: true },
      );
    });

    const session = new Browser.Session(socket);
    try {
      const { targetId } = (await session.send("Target.createTarget", {
        url: "about:blank",
      })) as {
        targetId: string;
      };
      const { sessionId } = (await session.send("Target.attachToTarget", {
        targetId,
        flatten: true,
      })) as { sessionId: string };

      await session.send(
        "Emulation.setDeviceMetricsOverride",
        {
          width: options.width,
          height: options.height,
          deviceScaleFactor: 1,
          mobile: false,
        },
        sessionId,
      );
      await session.send("Page.enable", {}, sessionId);
      await session.send("Page.navigate", { url }, sessionId);
      if (options.wait > 0)
        await new Promise((r) =>
          setTimeout(r, Math.min(options.wait, MAX_WAIT)),
        );

      const shot = (await session.send(
        "Page.captureScreenshot",
        { format: "png", captureBeyondViewport: options.fullPage },
        sessionId,
      )) as { data: string };

      let title = "";
      try {
        const evaluated = (await session.send(
          "Runtime.evaluate",
          { expression: "document.title", returnByValue: true },
          sessionId,
        )) as { result?: { value?: string } };
        title = evaluated.result?.value ?? "";
      } catch {
        // 标题拿不到不影响截图，页面可能仍在导航
      }

      const bytes = Buffer.from(shot.data, "base64");
      const dir = Browser.screenshotDir(options.dataRoot);
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, Browser.screenshotName(url));
      await writeFile(file, bytes);
      return { bytes, title, file, fullPage: options.fullPage };
    } finally {
      session.close();
    }
  } finally {
    child.kill();
    // 一次性 profile：留着只会在下次启动前堆积，并可能让调试端口被上一次的残留实例占住
    await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

type Metadata = {
  url: string;
  title: string;
  file: string;
  viewport: string;
  fullPage: boolean;
};

export const BrowserTool = Tool.define<typeof Parameters, Metadata, never>(
  "browser",
  Effect.gen(function* () {
    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          if (
            !params.url.startsWith("http://") &&
            !params.url.startsWith("https://")
          )
            throw new Error("URL 必须以 http:// 或 https:// 开头");
          const parsed = new URL(params.url);
          // 与 webfetch 保持同一套 SSRF 基线：不让浏览器去访问内网与回环
          if (
            parsed.hostname === "localhost" ||
            parsed.hostname === "127.0.0.1" ||
            parsed.hostname === "::1"
          )
            throw new Error(`不允许截图本机地址：${parsed.hostname}`);

          // 用 locateAll 拿到全部候选，让 launchAny 逐个试启动：
          // 存在但不损坏的浏览器优先，存在却损坏的会被自动跳过。
          const executables = Browser.locateAll(Browser.candidates());
          if (executables.length === 0)
            throw new Error(
              "本机未找到 Edge/Chrome/Chromium，无法截图。请先安装其一。",
            );

          yield* ctx.ask({
            permission: "browser",
            patterns: [params.url],
            always: ["*"],
            metadata: { url: params.url },
          });

          const result = yield* Effect.tryPromise(() =>
            capture(executables, params.url, {
              width: Math.min(
                params.width ?? DEFAULT_WIDTH,
                Browser.MAX_VIEWPORT_WIDTH,
              ),
              height: params.height ?? DEFAULT_HEIGHT,
              fullPage: params.full_page === true,
              wait: params.wait ?? DEFAULT_WAIT,
              timeout: Math.min(params.timeout ?? 30, 120) * 1000,
              dataRoot: Global.Path.data,
            }),
          ).pipe(
            Effect.mapError(
              (cause) =>
                new Error(
                  `截图失败：${cause instanceof Error ? cause.message : String(cause)}。` +
                    `请确认网络可达、页面没有无限加载。`,
                ),
            ),
          );

          const viewport = `${params.width ?? DEFAULT_WIDTH}x${params.height ?? DEFAULT_HEIGHT}`;
          return {
            title: `Screenshot: ${parsed.host}`,
            output: [
              `已截图：${params.url}`,
              `页面标题：${result.title === "" ? "（未取到）" : result.title}`,
              `视口：${viewport}${result.fullPage ? "（整页）" : "（仅可见区域）"}`,
              `文件：${result.file}`,
              ``,
              `以下为该页面的真实渲染截图。画面异常（错位、空白、缺图）可据此定位。`,
            ].join("\n"),
            metadata: {
              url: params.url,
              title: result.title,
              file: result.file,
              viewport,
              fullPage: result.fullPage,
            },
            attachments: [
              {
                type: "file" as const,
                mime: "image/png",
                filename: path.basename(result.file),
                url: `file://${result.file}`,
              },
            ],
          };
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>;
  }),
);
