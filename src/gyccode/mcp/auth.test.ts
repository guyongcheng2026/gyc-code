import { describe, expect, test } from "bun:test"
import { protectSecret } from "@gyccode/core/util/dpapi"
import { unprotectAll, type Entry } from "./auth"

const entryWithToken = (accessToken: string): Entry => ({ tokens: { accessToken } })

const garbageCipher = (): string =>
  "dpapi.v1:" + Buffer.from("definitely-not-a-dpapi-blob").toString("base64")

describe("McpAuth.unprotectAll", () => {
  test("plaintext legacy entries pass through without throwing", () => {
    const decoded = { legacy: entryWithToken("plain-oauth-token") }
    const { data, undecryptable } = unprotectAll(decoded)
    expect(undecryptable).toEqual([])
    expect(data.legacy?.tokens?.accessToken).toBe("plain-oauth-token")
  })

  test("protected secret round-trips to the original plaintext", () => {
    const cipher = protectSecret("super-secret-token")
    const { data, undecryptable } = unprotectAll({ srv: entryWithToken(cipher) })
    expect(undecryptable).toEqual([])
    expect(data.srv?.tokens?.accessToken).toBe("super-secret-token")
  })

  test("undecryptable cipher is preserved, never throws a defect", () => {
    const { data, undecryptable } = unprotectAll({ broken: entryWithToken(garbageCipher()) })
    expect(undecryptable).toEqual(["broken"])
    expect(data.broken?.tokens?.accessToken).toBe(garbageCipher())
  })

  test("one broken entry does not lose the decryptable ones", () => {
    const { data, undecryptable } = unprotectAll({
      good: entryWithToken(protectSecret("ok-token")),
      broken: entryWithToken(garbageCipher()),
      plain: entryWithToken("plain-token"),
    })
    expect(undecryptable).toEqual(["broken"])
    expect(data.good?.tokens?.accessToken).toBe("ok-token")
    expect(data.plain?.tokens?.accessToken).toBe("plain-token")
    expect(data.broken?.tokens?.accessToken).toBe(garbageCipher())
  })

  test("entries without secrets are untouched", () => {
    const entry: Entry = { serverUrl: "https://mcp.example/rpc" }
    const { data, undecryptable } = unprotectAll({ bare: entry })
    expect(undecryptable).toEqual([])
    expect(data.bare?.serverUrl).toBe("https://mcp.example/rpc")
  })
})
