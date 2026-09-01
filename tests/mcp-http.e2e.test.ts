import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type {
  FetchLike,
  Transport,
  TransportSendOptions,
} from "@modelcontextprotocol/sdk/shared/transport.js"
import type { JSONRPCMessage, MessageExtraInfo } from "@modelcontextprotocol/sdk/types.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it } from "vitest"
import { GET as getHealth } from "../api/health.js"
import { createMcpHttpHandler } from "../api/mcp.js"

const clients: Client[] = []

class StrictTransportAdapter implements Transport {
  onclose?: () => void
  onerror?: (error: Error) => void
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void

  constructor(private readonly inner: StreamableHTTPClientTransport) {}

  async start(): Promise<void> {
    this.inner.onclose = () => this.onclose?.()
    this.inner.onerror = (error) => this.onerror?.(error)
    this.inner.onmessage = (message) => this.onmessage?.(message)
    await this.inner.start()
  }

  async send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    await this.inner.send(message, options)
  }

  async close(): Promise<void> {
    await this.inner.close()
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion(version)
  }
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()))
})

describe("DAPA MCP Streamable HTTP", () => {
  it("exposes a no-store health response for deployment checks", async () => {
    const response = getHealth()

    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "dapa-mcp",
      transport: "streamable-http",
    })
  })

  it("supports initialization, tool discovery, and a local catalog tool call", async () => {
    const handler = createMcpHttpHandler({
      environment: {
        LAW_API_OC: "test-oc",
        DAPA_INFO_PATH: resolve(process.cwd(), "DAPA_info"),
      },
      workingDirectory: process.cwd(),
      packageRoot: process.cwd(),
    })
    const localFetch: FetchLike = async (url, init) => handler(new Request(url, init))
    const client = new Client({ name: "dapa-mcp-http-e2e", version: "1.0.0" })
    clients.push(client)
    const transport = new StrictTransportAdapter(
      new StreamableHTTPClientTransport(new URL("https://mcp.example/api/mcp"), {
        fetch: localFetch,
      }),
    )

    await client.connect(transport)
    const tools = await client.listTools()
    const result = CallToolResultSchema.parse(
      await client.callTool({
        name: "search_dapa_legal_catalog",
        arguments: { query: "방위사업관리규정", kind: "admin_rule", limit: 5 },
      }),
    )

    expect(tools.tools.map((tool) => tool.name)).toContain("get_legal_api_body")
    const text = result.content.find((item) => item.type === "text")
    expect(text?.type === "text" ? text.text : "").toContain("방위사업관리규정")
  })

  it("answers browser preflight requests with the MCP CORS contract", async () => {
    const handler = createMcpHttpHandler({
      environment: {},
      workingDirectory: process.cwd(),
      packageRoot: process.cwd(),
    })

    const response = await handler(
      new Request("https://mcp.example/api/mcp", { method: "OPTIONS" }),
    )

    expect(response.status).toBe(204)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    expect(response.headers.get("access-control-allow-methods")).toContain("POST")
    expect(response.headers.get("access-control-allow-headers")).toContain("MCP-Protocol-Version")
  })

  it("rejects oversized requests before constructing an MCP server", async () => {
    const handler = createMcpHttpHandler({
      environment: { MCP_MAX_REQUEST_BYTES: "1024" },
      workingDirectory: process.cwd(),
      packageRoot: process.cwd(),
    })
    const request = new Request("https://mcp.example/api/mcp", {
      method: "POST",
      headers: { "content-length": "1025", "content-type": "application/json" },
      body: "{}",
    })

    const response = await handler(request)

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32000 },
      id: null,
    })
  })

  it("returns a sanitized JSON-RPC error when bundled DAPA data is unavailable", async () => {
    const handler = createMcpHttpHandler({
      environment: { DAPA_INFO_PATH: "./missing-dapa-info" },
      workingDirectory: process.cwd(),
      packageRoot: process.cwd(),
    })

    const response = await handler(
      new Request("https://mcp.example/api/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    )

    expect(response.status).toBe(500)
    expect(response.headers.get("access-control-allow-origin")).toBe("*")
    await expect(response.json()).resolves.toMatchObject({
      jsonrpc: "2.0",
      error: { code: -32603, message: "Internal server error" },
      id: null,
    })
  })

  it.skipIf(process.env["RUN_LIVE_MCP_TESTS"] !== "1")(
    "retrieves the live official law list through the HTTP MCP tool",
    async () => {
      const handler = createMcpHttpHandler({
        environment: {
          LAW_API_OC: process.env["LAW_API_OC"] ?? "dusgh4847",
          DAPA_INFO_PATH: resolve(process.cwd(), "DAPA_info"),
        },
        workingDirectory: process.cwd(),
        packageRoot: process.cwd(),
      })
      const localFetch: FetchLike = async (url, init) => handler(new Request(url, init))
      const client = new Client({ name: "dapa-mcp-http-live", version: "1.0.0" })
      clients.push(client)
      await client.connect(
        new StrictTransportAdapter(
          new StreamableHTTPClientTransport(new URL("https://mcp.example/api/mcp"), {
            fetch: localFetch,
          }),
        ),
      )

      const result = CallToolResultSchema.parse(
        await client.callTool({
          name: "query_legal_api",
          arguments: { apiId: "law.list", query: "방위사업법", limit: 1 },
        }),
      )

      const text = result.content.find((item) => item.type === "text")
      expect(text?.type === "text" ? text.text : "").toContain("방위사업법")
    },
  )
})
