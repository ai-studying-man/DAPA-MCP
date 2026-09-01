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
