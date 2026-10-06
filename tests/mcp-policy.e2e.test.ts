import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { createDapaServer } from "../src/server/create-server.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()))
})
const SearchResult = z.object({
  results: z.array(z.object({ documentId: z.string() })),
  coverage: z.object({
    pages: z.array(z.object({ totalCount: z.number(), fetchedCount: z.number() })),
  }),
})
const ContentResult = z.object({
  results: z.array(z.object({ match: z.string(), document: z.object({ documentId: z.string() }) })),
  coverage: z.object({
    inspectedDocuments: z.number(),
    exhaustive: z.literal(false),
    paginationKnown: z.boolean(),
  }),
})

async function connect(api: FakeLawApi): Promise<Client> {
  const root = resolve(process.cwd(), "DAPA_info")
  const server = await createDapaServer({
    dapaInfoPath: root,
    dapaCatalogPath: resolve(root, "legal/catalog.json"),
    dapaPolicyPath: resolve(root, "policy/catalog.json"),
    law: { apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 },
    maxLawApiToolResponseChars: 250_000,
    legalContentSearchBudgetMs: 5_000,
  })
  const client = new Client({ name: "policy-regression", version: "1.0.0" })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  cleanups.push(async () => {
    await client.close()
    await server.close()
    await api.close()
  })
  return client
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<unknown> {
  const response = CallToolResultSchema.parse(await client.callTool({ name, arguments: args }))
  expect(response.isError).not.toBe(true)
  const content = response.content.find((item) => item.type === "text")
  if (content?.type !== "text") throw new Error("MCP result has no text payload")
  return JSON.parse(content.text)
}

describe("MCP current-law and defense evidence policy", () => {
  it("defaults to effective current law through the actual MCP client", async () => {
    // Given
    const requests: URL[] = []
    const api = await startFakeLawApi((request, response) => {
      requests.push(new URL(request.url ?? "/", "http://localhost"))
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "2",
            law: [
              {
                법령일련번호: "current",
                법령명한글: "방위사업법",
                시행일자: "20200101",
                현행연혁코드: "현행",
              },
              {
                법령일련번호: "future",
                법령명한글: "방위사업법",
                시행일자: "29990101",
                현행연혁코드: "현행",
              },
            ],
          },
        }),
      )
    })
    const client = await connect(api)
    // When
    const result = SearchResult.parse(await call(client, "search_legal", { query: "방위사업법" }))
    // Then
    expect(result.results.map(({ documentId }) => documentId)).toEqual(["current"])
    expect(result.coverage.pages[0]).toMatchObject({ totalCount: 2, fetchedCount: 2 })
    expect(requests[0]?.searchParams.get("target")).toBe("eflaw")
    expect(requests[0]?.searchParams.get("nw")).toBe("3")
  })

  it("keeps a defense body first and rejects background-only evidence through MCP", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      const id = url.searchParams.get("ID")
      response.end(
        JSON.stringify(
          url.pathname === "/lawSearch.do"
            ? {
                AdmRulSearch: {
                  totalCnt: "3",
                  admrul: [
                    { 행정규칙일련번호: "other", 행정규칙명: "시험평가", 소관부처명: "타기관" },
                    {
                      행정규칙일련번호: "dapa",
                      행정규칙명: "방위사업관리규정",
                      소관부처명: "방위사업청",
                    },
                    {
                      행정규칙일련번호: "context",
                      행정규칙명: "조직 규정",
                      소관부처명: "방위사업청",
                    },
                  ],
                },
              }
            : {
                AdmRulService: {
                  행정규칙기본정보: { 행정규칙명: id },
                  조문내용: [
                    id === "context"
                      ? "제1조 방위사업청 조직 운영 사항"
                      : "제1조 시험평가 적용 기준",
                  ],
                },
              },
        ),
      )
    })
    const client = await connect(api)
    // When
    const result = ContentResult.parse(
      await call(client, "search_legal_content", {
        query: "방위사업청에서 시험평가를 알려줘",
        types: ["administrative_rule"],
        mode: "thorough",
      }),
    )
    // Then
    expect(result.results[0]).toMatchObject({ match: "content", document: { documentId: "dapa" } })
    expect(result.coverage).toMatchObject({
      inspectedDocuments: 3,
      exhaustive: false,
      paginationKnown: true,
    })
    expect(result.results.find(({ document }) => document.documentId === "context")?.match).toBe(
      "metadata",
    )
    expect(result.results.find(({ document }) => document.documentId === "other")?.match).toBe(
      "content",
    )
  })
})
