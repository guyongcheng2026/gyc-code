// 真实渲染冒烟：拉起本机浏览器走 CDP 截一张图。
// 只有在浏览器存在时才跑；不存在则跳过，不把「没装浏览器」记成失败。
import { test, expect } from "bun:test";
import { mkdtempSync } from "fs";
import os from "os";
import { spawn } from "child_process";
import path from "path";
import { Browser } from "./browser";

// locate 返回 string | undefined；skipIf 只跳过、不收窄类型，这里显式兜一层非空断言
const executable = Browser.locate(undefined, Browser.candidates())!;
const root = mkdtempSync(path.join(os.tmpdir(), "gyc-browser-smoke-"));

const page = `<!doctype html><html><head><meta charset="utf-8"><title>自检页</title>
<style>body{margin:0;font:32px system-ui;background:#0a0;color:#fff}
h1{padding:40px} .box{width:200px;height:120px;background:#3af;margin:20px 40px}</style></head>
<body><h1>渲染自检</h1><div class="box"></div></body></html>`;

test.skipIf(!Browser.locate(undefined, Browser.candidates()))(
  "CDP 截图：真实渲染出 PNG",
  async () => {
    const { writeFile, mkdir } = await import("fs/promises");

    const port = 9333;
    const profile = path.join(root, "profile");
    await mkdir(profile, { recursive: true });
    const html = path.join(root, "index.html");
    await writeFile(html, page, "utf8");

    // 本机 Chrome 存在但启动即失败，所以像生产路径那样逐个候选试启动。
    const args: string[] = [...Browser.launchArgs(profile, port)];
    let child = spawn(executable, args, { stdio: "ignore" });
    let endpoint: string | undefined;
    try {
      try {
        endpoint = await Browser.waitForEndpoint(port, Date.now() + 20_000);
      } catch {
        child.kill();
        const edge = Browser.locateAll(Browser.candidates()).find(
          (c) => c !== executable,
        );
        if (edge === undefined)
          throw new Error("除已知损坏的 Chrome 外没有其他浏览器");
        child = spawn(edge, [...args], { stdio: "ignore" });
        endpoint = await Browser.waitForEndpoint(port, Date.now() + 20_000);
      }
      expect(endpoint).toContain("ws://");

      const socket = new WebSocket(endpoint!);
      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener(
          "error",
          () => reject(new Error("CDP 连接失败")),
          { once: true },
        );
      });
      const session = new Browser.Session(socket);

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
        { width: 800, height: 600, deviceScaleFactor: 1, mobile: false },
        sessionId,
      );
      await session.send("Page.enable", {}, sessionId);
      await session.send(
        "Page.navigate",
        { url: `file:///${html.replace(/\\/g, "/")}` },
        sessionId,
      );
      await new Promise((r) => setTimeout(r, 800));

      const evaluated = (await session.send(
        "Runtime.evaluate",
        { expression: "document.title", returnByValue: true },
        sessionId,
      )) as { result?: { value?: string } };
      expect(evaluated.result?.value).toBe("自检页");

      const shot = (await session.send(
        "Page.captureScreenshot",
        { format: "png" },
        sessionId,
      )) as {
        data: string;
      };
      const bytes = Buffer.from(shot.data, "base64");
      // PNG 魔数 + 合理体积：证明拿到的是真实渲染像素而不是空壳
      expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
      expect(bytes.length).toBeGreaterThan(1000);

      session.close();
    } finally {
      child.kill();
    }
  },
  60_000,
);
