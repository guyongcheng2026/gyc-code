import { describe, expect, test } from "bun:test"
import { hostnameOfHostHeader, isLoopbackHostname } from "./host-guard"

describe("hostnameOfHostHeader", () => {
  test("strips port from host:port", () => {
    expect(hostnameOfHostHeader("localhost:5173")).toBe("localhost")
    expect(hostnameOfHostHeader("127.0.0.1:4099")).toBe("127.0.0.1")
  })

  test("keeps port-less host as-is", () => {
    expect(hostnameOfHostHeader("localhost")).toBe("localhost")
    expect(hostnameOfHostHeader("127.0.0.1")).toBe("127.0.0.1")
  })

  test("keeps IPv6 literal bracketed with port", () => {
    expect(hostnameOfHostHeader("[::1]:8080")).toBe("[::1]")
    expect(hostnameOfHostHeader("[::1]")).toBe("[::1]")
    expect(hostnameOfHostHeader("[::ffff:127.0.0.1]:80")).toBe("[::ffff:127.0.0.1]")
  })

  test("handles missing/empty host without throwing", () => {
    expect(hostnameOfHostHeader(undefined)).toBeUndefined()
    expect(hostnameOfHostHeader("")).toBeUndefined()
  })
})

describe("isLoopbackHostname", () => {
  test("loopback forms are accepted", () => {
    expect(isLoopbackHostname("localhost")).toBe(true)
    expect(isLoopbackHostname("LOCALHOST")).toBe(true)
    expect(isLoopbackHostname("127.0.0.1")).toBe(true)
    expect(isLoopbackHostname("127.1.2.3")).toBe(true)
    expect(isLoopbackHostname("[::1]")).toBe(true)
    expect(isLoopbackHostname("::1")).toBe(true)
    expect(isLoopbackHostname("[::ffff:127.0.0.1]")).toBe(true)
    expect(isLoopbackHostname("0:0:0:0:0:0:0:1")).toBe(true)
  })

  test("attacker / LAN hostnames are rejected", () => {
    expect(isLoopbackHostname("gyccode.ai")).toBe(false)
    expect(isLoopbackHostname("192.168.1.5")).toBe(false)
    expect(isLoopbackHostname("100.64.0.1")).toBe(false)
    expect(isLoopbackHostname("127.evil.com")).toBe(false)
    expect(isLoopbackHostname("127.0.0.1.evil.com")).toBe(false)
    expect(isLoopbackHostname("128.0.0.1")).toBe(false)
    expect(isLoopbackHostname("0.0.0.0")).toBe(false)
    expect(isLoopbackHostname("[::ffff:c0a8:105]")).toBe(false)
  })

  test("out-of-range IPv4 octets are rejected", () => {
    expect(isLoopbackHostname("127.999.1.1")).toBe(false)
    expect(isLoopbackHostname("127.0.0.256")).toBe(false)
  })
})
