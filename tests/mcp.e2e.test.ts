import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"

let client: Client
let transport: StdioClientTransport

beforeEach(async () => {
  client = new Client({ name: "dapa-mcp-e2e", version: "1.0.0" })
  transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve(process.cwd(), "dist/index.js")],
    cwd: process.cwd(),
    env: {
      PATH: process.env["PATH"] ?? "",
      DAPA_INFO_PATH: resolve(process.cwd(), "DAPA_info"),
    },
    stderr: "pipe",
  })
  await client.connect(transport)
})

afterEach(async () => {
  await transport.close()
})

describe("DAPA MCP stdio", () => {
  it("advertises the legal and DAPA catalog tools", async () => {
    // Given
    const expected = [
      "get_dapa_organization",
      "get_dapa_legal_catalog_item",
      "get_dapa_legal_content",
      "get_dapa_policy_page",
      "get_legal_api_body",
      "get_legal_detail",
      "get_legal_history",
      "list_legal_apis",
      "query_legal_api",
      "search_legal_content",
      "dapa_catalog_status",
      "search_dapa_info",
      "search_dapa_legal_catalog",
      "search_dapa_policy",
      "search_legal",
      "source_health",
      "verify_citations",
    ]

    // When
    const response = await client.listTools()

    // Then
    expect(response.tools.map((tool) => tool.name).sort()).toEqual(expected.sort())
  })

  it("publishes server instructions during initialization", () => {
    // Given
    const connectedClient = client

    // When
    const instructions = connectedClient.getInstructions()

    // Then
    expect(instructions).toEqual(expect.any(String))
    expect(instructions?.length).toBeGreaterThan(0)
  })

  it("reports the law provider as healthy when LAW_API_OC is omitted", async () => {
    // Given
    const request = { name: "source_health", arguments: {} }

    // When
    const response = CallToolResultSchema.parse(await client.callTool(request))
    const text = response.content.find((item) => item.type === "text")
    const parsed = z
      .object({ law: z.literal("healthy") })
      .parse(JSON.parse(text?.type === "text" ? text.text : "{}"))

    // Then
    expect(parsed.law).toBe("healthy")
  })

  it("retrieves synchronized work-policy content through stdio", async () => {
    // Given
    const searchRequest = {
      name: "search_dapa_policy",
      arguments: { query: "핵심기술", limit: 5 },
    }

    // When
    const searchResponse = CallToolResultSchema.parse(await client.callTool(searchRequest))
    const searchText = searchResponse.content.find((item) => item.type === "text")
    const detailResponse = CallToolResultSchema.parse(
      await client.callTool({ name: "get_dapa_policy_page", arguments: { id: "policy:4088" } }),
    )
    const detailText = detailResponse.content.find((item) => item.type === "text")

    // Then
    expect(searchText?.type === "text" ? searchText.text : "").toContain('"id": "policy:4088"')
    expect(detailText?.type === "text" ? detailText.text : "").toContain("국방기술")
  })

  it("answers an IPT lookup through a real stdio tool call", async () => {
    // Given
    const request = { name: "search_dapa_info", arguments: { query: "IPT", limit: 5 } }

    // When
    const response = CallToolResultSchema.parse(await client.callTool(request))

    // Then
    const text = response.content.find((item) => item.type === "text")
    expect(text?.type === "text" ? text.text : "").toContain("통합사업관리팀")
  })

  it("answers a DAPA administrative-rule catalog lookup through stdio", async () => {
    // Given
    const request = {
      name: "search_dapa_legal_catalog",
      arguments: { query: "방위사업관리규정", kind: "admin_rule", limit: 5 },
    }

    // When
    const response = CallToolResultSchema.parse(await client.callTool(request))
    const text = response.content.find((item) => item.type === "text")

    // Then
    expect(text?.type === "text" ? text.text : "").toContain('"kind": "admin_rule"')
    expect(text?.type === "text" ? text.text : "").toContain("방위사업관리규정")
  })

  it("lists the on-demand official legal API catalog without an explicit OC", async () => {
    // Given
    const request = { name: "list_legal_apis", arguments: {} }

    // When
    const response = CallToolResultSchema.parse(await client.callTool(request))
    const text = response.content.find((item) => item.type === "text")
    const parsed = z
      .object({ categories: z.array(z.object({ id: z.string() })) })
      .parse(JSON.parse(text?.type === "text" ? text.text : "{}"))

    // Then
    expect(parsed.categories).toHaveLength(14)
    expect(parsed.categories.map((category) => category.id)).toContain(
      "central_ministry_interpretation",
    )
  })
})
