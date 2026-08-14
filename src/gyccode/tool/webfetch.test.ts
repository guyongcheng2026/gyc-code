import { test, expect } from "bun:test"
import { Effect } from "effect"
import { HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import { createServer, type Server } from "node:http"
import { redirectLoop } from "./webfetch"

// Runs redirectLoop against a real local HTTP server through the fetch client,
// with native redirect following disabled (redirect: "manual").
const fetchWithRedirects = (url: string, redirects: number) =>
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient
    return yield* redirectLoop(client, HttpClientRequest.get(url), redirects)
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
  )

const listen = (server: Server) =>
  new Promise<number>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port))
  })

test("rejects a redirect to a private/loopback/metadata address", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" })
    res.end()
  })
  const port = await listen(server)
  try {
    await expect(
      Effect.runPromise(fetchWithRedirects(`http://127.0.0.1:${port}/start`, 5)),
    ).rejects.toThrow(/Redirect target points to a private\/loopback address/)
  } finally {
    server.close()
  }
})

test("rejects a redirect chain into loopback", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(302, { Location: "http://127.0.0.1:9/private" })
    res.end()
  })
  const port = await listen(server)
  try {
    await expect(
      Effect.runPromise(fetchWithRedirects(`http://127.0.0.1:${port}/start`, 5)),
    ).rejects.toThrow(/Redirect target points to a private\/loopback address/)
  } finally {
    server.close()
  }
})

test("passes through a non-redirect response unchanged", async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("ok")
  })
  const port = await listen(server)
  try {
    const response = await Effect.runPromise(fetchWithRedirects(`http://127.0.0.1:${port}/start`, 5))
    expect(response.status).toBe(200)
  } finally {
    server.close()
  }
})