import { resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { loadRuntimeConfig } from "../src/server/runtime-config.js"

describe("DAPA MCP runtime configuration", () => {
  it("builds a server configuration with cloud-safe defaults", () => {
    const projectRoot = process.cwd()

    const config = loadRuntimeConfig(
      { LAW_API_OC: "test-oc", DAPA_INFO_PATH: "./DAPA_info" },
      { workingDirectory: projectRoot, packageRoot: projectRoot },
    )

    expect(config.server.dapaInfoPath).toBe(resolve(projectRoot, "DAPA_info"))
    expect(config.server.law.apiKey).toBe("test-oc")
    expect(config.server.law.referer).toBe("https://www.law.go.kr/")
    expect(config.server.law.userAgent).toContain("dapa-mcp")
    expect(config.server.law.timeoutMs).toBe(55_000)
    expect(config.maxMcpRequestBytes).toBe(1024 * 1024)
  })

  it("keeps the shared OC default when the environment omits it", () => {
    const config = loadRuntimeConfig(
      { DAPA_INFO_PATH: "./DAPA_info" },
      { workingDirectory: process.cwd(), packageRoot: process.cwd() },
    )

    expect(config.server.law.apiKey).toBe("dusgh4847")
  })

  it("uses defaults when Vercel provides blank detected environment values", () => {
    const config = loadRuntimeConfig(
      {
        LAW_API_OC: "",
        LAW_API_TIMEOUT_MS: "",
        LAW_API_RETRY_LIMIT: "",
        LAW_API_CACHE_TTL_MS: "",
        LAW_API_MAX_TEXT_RESPONSE_BYTES: "",
        LAW_API_MAX_RESOURCE_RESPONSE_BYTES: "",
        LAW_API_MAX_TOOL_RESPONSE_CHARS: "",
        LAW_API_REFERER: "",
        LAW_API_USER_AGENT: "",
        MCP_MAX_REQUEST_BYTES: "",
        DAPA_INFO_PATH: "",
      },
      { workingDirectory: process.cwd(), packageRoot: process.cwd() },
    )

    expect(config.server.dapaInfoPath).toBe(resolve(process.cwd(), "DAPA_info"))
    expect(config.server.law.apiKey).toBe("dusgh4847")
    expect(config.server.law.timeoutMs).toBe(55_000)
    expect(config.server.law.retryLimit).toBe(2)
    expect(config.server.law.cacheTtlMs).toBe(300_000)
    expect(config.server.law.maxTextResponseBytes).toBe(8 * 1024 * 1024)
    expect(config.server.law.maxResourceResponseBytes).toBe(25 * 1024 * 1024)
    expect(config.server.maxLawApiToolResponseChars).toBe(250_000)
    expect(config.server.law.referer).toBe("https://www.law.go.kr/")
    expect(config.maxMcpRequestBytes).toBe(1024 * 1024)
  })

  it("rejects an unsafe MCP request-size configuration", () => {
    const environment = { MCP_MAX_REQUEST_BYTES: "100" }

    expect(() =>
      loadRuntimeConfig(environment, {
        workingDirectory: process.cwd(),
        packageRoot: process.cwd(),
      }),
    ).toThrow()
  })
})
