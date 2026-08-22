// jsdom polyfill：xterm/canvas/ResizeObserver
// 终端面板渲染依赖 canvas 2D context 与 ResizeObserver，测试环境用空桩替代。

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

if (typeof HTMLCanvasElement !== "undefined") {
  const ctxStub = new Proxy(
    {},
    { get: () => () => {} },
  ) as unknown as CanvasRenderingContext2D
  HTMLCanvasElement.prototype.getContext = function () {
    return ctxStub
  } as typeof HTMLCanvasElement.prototype.getContext
}
