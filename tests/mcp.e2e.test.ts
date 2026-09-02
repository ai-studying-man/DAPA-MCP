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
    const expected = {
      dapa_catalog_status: "방위사업청 법령 카탈로그 상태",
      get_dapa_legal_catalog_item: "방위사업청 법령 카탈로그 조회",
      get_dapa_legal_content: "방위사업청 법령 원문 조회",
      get_dapa_organization: "방위사업청 조직정보 조회",
      get_dapa_policy_page: "방위사업청 정책자료 원문 조회",
      get_legal_api_body: "국가법령정보 본문·첨부 조회",
      get_legal_detail: "공식 법령·판례 상세 조회",
      get_legal_history: "법령 연혁 조회",
      list_legal_apis: "국가법령정보 API 목록",
      query_legal_api: "국가법령정보 API 조회",
      search_dapa_info: "방위사업청 업무정보 검색",
      search_dapa_legal_catalog: "방위사업청 법령·행정규칙 검색",
      search_dapa_policy: "방위사업청 정책자료 검색",
      search_legal: "공식 법령·판례 검색",
      search_legal_content: "법령·행정규칙 본문 검색",
      source_health: "공식 출처 연결 상태",
      verify_citations: "법령 인용 검증",
    } as const

    // When
    const response = await client.listTools()

    // Then
    expect(Object.fromEntries(response.tools.map((tool) => [tool.name, tool.title]))).toEqual(
      expected,
    )
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
