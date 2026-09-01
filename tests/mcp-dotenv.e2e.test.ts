import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { afterEach, describe, expect, it } from "vitest"

const transports: StdioClientTransport[] = []

afterEach(async () => {
  await Promise.all(transports.splice(0).map((transport) => transport.close()))
})

describe("DAPA MCP dotenv startup", () => {
  it("loads DAPA_INFO_PATH from a dotenv file in the working directory", async () => {
    // Given
    const workingDirectory = await mkdtemp(resolve(tmpdir(), "dapa-mcp-dotenv-"))
    await writeFile(
      resolve(workingDirectory, ".env"),
      `DAPA_INFO_PATH=${resolve(process.cwd(), "DAPA_info")}\n`,
      "utf8",
    )
    const client = new Client({ name: "dapa-mcp-dotenv-e2e", version: "1.0.0" })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(process.cwd(), "dist/index.js")],
      cwd: workingDirectory,
      env: { PATH: process.env["PATH"] ?? "" },
      stderr: "pipe",
    })
    transports.push(transport)

    // When
    try {
      await client.connect(transport)
      const response = await client.listTools()

      // Then
      expect(response.tools).toHaveLength(17)
    } finally {
      await client.close()
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })

  it("finds bundled DAPA_info when launched outside the repository", async () => {
    // Given
    const workingDirectory = await mkdtemp(resolve(tmpdir(), "dapa-mcp-cwd-"))
    const client = new Client({ name: "dapa-mcp-cwd-e2e", version: "1.0.0" })
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(process.cwd(), "dist/index.js")],
      cwd: workingDirectory,
      env: { PATH: process.env["PATH"] ?? "" },
      stderr: "pipe",
    })
    transports.push(transport)

    // When
    try {
      await client.connect(transport)
      const response = await client.listTools()

      // Then
      expect(response.tools).toHaveLength(17)
    } finally {
      await client.close()
      await rm(workingDirectory, { recursive: true, force: true })
    }
  })
})
