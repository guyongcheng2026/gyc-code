// 无头浏览器 + 截图工具（P2-2）单元测试
//
// 路线：不用 playwright/puppeteer，改为拉起本机已装的 Chromium 系浏览器，
// 走 CDP（Chrome DevTools Protocol）驱动。理由是仓库零新增依赖的约束，
// 而且 Node 自带 WebSocket，够跟 CDP 说话。
//
// 本文件只测纯逻辑部分：浏览器发现、CDP 端点解析、URL 白名单、文件名清洗。
// 真实渲染需要本机浏览器，放到 CLI 层做冒烟。
import { describe, expect, test } from "bun:test";
import { Browser } from "./browser";

describe("Browser.locate — 发现本机浏览器", () => {
  // 测试注入假的 exists，不依赖本机是否真装了浏览器
  const only = (present: ReadonlyArray<string>) => (candidate: string) =>
    present.includes(candidate);

  test("显式指定的路径优先，不做任何探测", () => {
    expect(Browser.locate("C:/custom/chrome.exe", [], () => false)).toBe(
      "C:/custom/chrome.exe",
    );
  });

  test("空列表返回 undefined，调用方负责给出可执行的提示", () => {
    expect(Browser.locate(undefined, [], () => false)).toBeUndefined();
  });

  test("按候选顺序取第一个存在的，不存在则继续往后找", () => {
    expect(
      Browser.locate(
        undefined,
        ["C:/nope/a.exe", "C:/yes/b.exe"],
        only(["C:/yes/b.exe"]),
      ),
    ).toBe("C:/yes/b.exe");
  });

  test("全部候选都不存在返回 undefined", () => {
    expect(
      Browser.locate(
        undefined,
        ["C:/nope/a.exe", "C:/nope/b.exe"],
        () => false,
      ),
    ).toBeUndefined();
  });

  test("空字符串视为未指定，继续走候选探测", () => {
    expect(Browser.locate("", ["C:/yes/b.exe"], only(["C:/yes/b.exe"]))).toBe(
      "C:/yes/b.exe",
    );
  });

  test("candidate 按平台给出，Windows 含 Edge 与 Chrome 的常见安装位", () => {
    const windows = Browser.candidates("win32");
    expect(windows.some((p) => p.includes("Edge"))).toBe(true);
    expect(windows.some((p) => p.includes("Chrome"))).toBe(true);
  });

  test("非 Windows 平台给 posix 路径候选", () => {
    const posix = Browser.candidates("darwin");
    expect(posix.every((p) => p.startsWith("/"))).toBe(true);
    expect(posix.length).toBeGreaterThan(0);
  });
});

describe("Browser.parseEndpoint — CDP WebSocket 端点", () => {
  test("从 CDP 端口的 json 列表里取出 browser 级 ws 地址", () => {
    const pages = JSON.stringify([
      { webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/AAA" },
      { webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/BBB" },
    ]);
    expect(Browser.parseEndpoint(pages)).toBe(
      "ws://127.0.0.1:9222/devtools/browser/BBB",
    );
  });

  test("只有 page 级端点时退回第一个可用地址", () => {
    const pages = JSON.stringify([
      { webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/AAA" },
    ]);
    expect(Browser.parseEndpoint(pages)).toBe(
      "ws://127.0.0.1:9222/devtools/page/AAA",
    );
  });

  test("优先 browser 级端点而不是页面级", () => {
    const pages = JSON.stringify([
      { webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/AAA" },
      { webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/BBB" },
      { webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/page/CCC" },
    ]);
    expect(Browser.parseEndpoint(pages)?.endsWith("/BBB")).toBe(true);
  });

  test("空列表返回 undefined", () => {
    expect(Browser.parseEndpoint("[]")).toBeUndefined();
  });

  test("非法 JSON 返回 undefined，不抛错", () => {
    expect(Browser.parseEndpoint("not json")).toBeUndefined();
  });

  test("没有 webSocketDebuggerUrl 的条目被忽略", () => {
    expect(
      Browser.parseEndpoint(JSON.stringify([{ id: "x" }])),
    ).toBeUndefined();
  });
});

describe("Browser.screenshotName — 截图文件名", () => {
  test("纯域名时得到可读且合法的文件名", () => {
    expect(Browser.screenshotName("https://example.com/docs")).toBe(
      "example.com_docs.png",
    );
  });

  test("路径分隔符被替换，不会逃出目录", () => {
    const name = Browser.screenshotName("https://example.com/a/b/c");
    expect(name).not.toContain("/");
    expect(name).not.toContain("\\");
    expect(name).not.toContain("..");
  });

  test("Windows 盘符与冒号被清洗", () => {
    const name = Browser.screenshotName("file:///C:/Windows/System32");
    expect(name).not.toContain(":");
    expect(name).toMatch(/\.png$/);
  });

  test("query 与 hash 被剥掉，避免文件名过长", () => {
    expect(Browser.screenshotName("https://example.com/p?a=1&b=2#frag")).toBe(
      "example.com_p.png",
    );
  });

  test("截断超长名字，避免超出文件系统上限", () => {
    const name = Browser.screenshotName(
      `https://example.com/${"x".repeat(500)}`,
    );
    expect(name.length).toBeLessThanOrEqual(80);
  });

  test("无法解析的 URL 也能给出合法名字", () => {
    expect(Browser.screenshotName("::::")).toMatch(/^[a-z0-9_.-]+\.png$/);
  });
});
