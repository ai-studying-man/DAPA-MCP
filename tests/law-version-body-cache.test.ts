import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { LawApiProvider } from "../src/providers/law/law-api-provider.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { createDapaServer } from "../src/server/create-server.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

async function fixture() {
  const requests: URL[] = []
  const state = { currentId: "2" }
  const api = await startFakeLawApi((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    requests.push(url)
    const id = url.searchParams.get("MST") ?? "1"
    response.end(
      JSON.stringify(
        url.pathname === "/lawSearch.do"
          ? {
              LawSearch: {
                totalCnt: "1",
                law: {
                  법령일련번호: state.currentId,
                  법령ID: "10107",
                  법령명한글: "방위사업법",
                  시행일자: "20200101",
                  현행연혁코드: "현행",
                },
              },
            }
          : {
              법령: {
                기본정보: { 법령명_한글: "방위사업법", 법령ID: "10107", 시행일자: "20200101" },
                조문: { 조문단위: { 조문번호: "1", 조문내용: `본문 ${id}` } },
              },
            },
      ),
    )
  })
  apis.push(api)
  const config = {
    apiKey: "test",
    baseUrl: api.baseUrl,
    retryLimit: 0,
    cacheTtlMs: 100,
    detailCacheTtlMs: 60_000,
  }
  const provider = new LawProvider(config)
  return { requests, state, provider, config }
}

describe("official version body cache", () => {
  it.each([false, true])(
    "rechecks administrative mappings and downloads a body only when changed=%s",
    async (changed) => {
      // Given
      vi.useFakeTimers({ toFake: ["Date"] })
      const requests: URL[] = []
      const state = { currentId: "1" }
      const api = await startFakeLawApi((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        requests.push(url)
        response.end(
          JSON.stringify(
            url.pathname === "/lawSearch.do"
              ? {
                  AdmRulSearch: {
                    totalCnt: "1",
                    admrul: {
                      행정규칙일련번호: state.currentId,
                      행정규칙ID: "38163",
                      행정규칙명: "방위사업관리규정",
                      시행일자: "20200101",
                      현행연혁구분: "현행",
                    },
                  },
                }
              : {
                  AdmRulService: {
                    행정규칙기본정보: {
                      행정규칙명: "방위사업관리규정",
                      행정규칙ID: "38163",
                      시행일자: "20200101",
                    },
                    조문내용: [`제1조(시험평가) 본문 ${url.searchParams.get("ID")}`],
                  },
                },
          ),
        )
      })
      apis.push(api)
      const provider = new LawProvider({
        apiKey: "test",
        baseUrl: api.baseUrl,
        retryLimit: 0,
        cacheTtlMs: 100,
        detailCacheTtlMs: 60_000,
      })
      await provider.getDetail({ sourceType: "administrative_rule", documentId: "1" })
      state.currentId = changed ? "2" : "1"
      vi.advanceTimersByTime(101)
      // When
      const result = await provider.getDetail({
        sourceType: "administrative_rule",
        documentId: "1",
      })
      // Then
      expect(result.status).toBe("OK")
      expect(result.results[0]?.documentId).toBe(state.currentId)
      expect(requests.filter((url) => url.pathname === "/lawSearch.do")).toHaveLength(2)
      expect(requests.filter((url) => url.pathname === "/lawService.do")).toHaveLength(
        changed ? 2 : 1,
      )
    },
  )
  it("revalidates current mapping and reuses the body through an actual MCP client", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["Date"] })
    const { config, requests } = await fixture()
    const root = resolve(process.cwd(), "DAPA_info")
    const server = await createDapaServer({
      dapaInfoPath: root,
      dapaCatalogPath: resolve(root, "legal/catalog.json"),
      dapaPolicyPath: resolve(root, "policy/catalog.json"),
      law: config,
      maxLawApiToolResponseChars: 250_000,
      legalContentSearchBudgetMs: 5_000,
    })
    const client = new Client({ name: "cache-regression", version: "1.0.0" })
    const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
    try {
      await server.connect(serverTransport)
      await client.connect(clientTransport)
      const args = { name: "get_legal_detail", arguments: { documentId: "1", sourceType: "law" } }
      await client.callTool(args)
      vi.advanceTimersByTime(101)
      // When
      const result = CallToolResultSchema.parse(await client.callTool(args))
      // Then
      expect(result.isError).not.toBe(true)
      const content = result.content.find((item) => item.type === "text")
      if (content?.type !== "text") throw new Error("MCP body result has no text payload")
      const body = z
        .object({ status: z.literal("OK"), results: z.array(z.object({ documentId: z.string() })) })
        .parse(JSON.parse(content.text))
      expect(body.results[0]?.documentId).toBe("2")
      expect(requests.filter((url) => url.pathname === "/lawSearch.do")).toHaveLength(2)
      expect(requests.filter((url) => url.pathname === "/lawService.do")).toHaveLength(2)
    } finally {
      await client.close()
      await server.close()
    }
  })
  it("keeps an explicit old version separate while reusing its already fetched official body", async () => {
    // Given
    const { provider, requests } = await fixture()
    await provider.getDetail({ sourceType: "law", documentId: "1" })
    // When
    const result = await provider.getDetail({
      sourceType: "law",
      documentId: "1",
      currentOnly: false,
    })
    // Then
    expect(result.results[0]?.documentId).toBe("1")
    expect(result.results[0]?.status).toBe("unknown")
    expect(result.detail?.articles[0]?.text).toContain("본문 1")
    expect(requests.filter((url) => url.pathname === "/lawService.do")).toHaveLength(2)
  })
  it("reuses the exact official body through the generic API path after mapping TTL", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["Date"] })
    const { requests, config } = await fixture()
    const provider = new LawApiProvider(config)
    await provider.query({ apiId: "law.detail", documentId: "1" })
    vi.advanceTimersByTime(101)
    // When
    const response = await provider.query({ apiId: "law.detail", documentId: "1" })
    // Then
    expect(response.status).toBe("OK")
    expect(requests.filter((url) => url.pathname === "/lawSearch.do")).toHaveLength(2)
    expect(requests.filter((url) => url.pathname === "/lawService.do")).toHaveLength(2)
  })

  it("resolves a requested historical date separately without downloading the same version again", async () => {
    // Given
    const { provider, requests } = await fixture()
    await provider.getDetail({ sourceType: "law", documentId: "1" })
    // When
    const result = await provider.getDetail({
      sourceType: "law",
      documentId: "1",
      asOfDate: "2021-01-01",
    })
    // Then
    expect(result.results[0]?.documentId).toBe("2")
    expect(requests.filter((url) => url.pathname === "/lawSearch.do")).toHaveLength(2)
    expect(requests.filter((url) => url.pathname === "/lawService.do")).toHaveLength(2)
    expect(requests.at(-1)?.searchParams.get("efYd")).toBe("00010101~20210101")
  })
  it("rechecks current mapping without refetching an unchanged official body after mapping TTL", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["Date"] })
    const { provider, requests } = await fixture()
    await provider.getDetail({ sourceType: "law", documentId: "1" })
    vi.advanceTimersByTime(101)
    // When
    const result = await provider.getDetail({ sourceType: "law", documentId: "1" })
    // Then
    expect(result.results[0]?.documentId).toBe("2")
    expect(requests.filter((url) => url.pathname === "/lawSearch.do")).toHaveLength(2)
    expect(requests.filter((url) => url.pathname === "/lawService.do")).toHaveLength(2)
  })

  it("fetches the newly effective body when short current mapping expires", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["Date"] })
    const { provider, requests, state } = await fixture()
    await provider.getDetail({ sourceType: "law", documentId: "1" })
    state.currentId = "3"
    vi.advanceTimersByTime(101)
    // When
    const result = await provider.getDetail({ sourceType: "law", documentId: "1" })
    // Then
    expect(result.results[0]?.documentId).toBe("3")
    expect(result.detail?.articles[0]?.text).toContain("본문 3")
    expect(requests.filter((url) => url.searchParams.get("MST") === "3")).toHaveLength(1)
    expect(requests.filter((url) => url.searchParams.get("MST") === "1")).toHaveLength(1)
  })

  it("bypasses both cached mapping and body when forceRefresh is requested", async () => {
    // Given
    const { provider, requests } = await fixture()
    await provider.getDetail({ sourceType: "law", documentId: "1" })
    // When
    await provider.getDetail({ sourceType: "law", documentId: "1", forceRefresh: true })
    // Then
    expect(requests.filter((url) => url.pathname === "/lawSearch.do")).toHaveLength(2)
    expect(requests.filter((url) => url.pathname === "/lawService.do")).toHaveLength(4)
  })

  it("rechecks today's mapping at Korea midnight even within mapping TTL", async () => {
    // Given
    vi.useFakeTimers({ toFake: ["Date"] })
    vi.setSystemTime(new Date("2026-10-05T14:59:59.990Z"))
    const { provider, requests } = await fixture()
    await provider.getDetail({ sourceType: "law", documentId: "1" })
    vi.advanceTimersByTime(20)
    // When
    const result = await provider.getDetail({ sourceType: "law", documentId: "1" })
    // Then
    expect(result.results[0]?.status).toBe("current")
    expect(requests.filter((url) => url.pathname === "/lawSearch.do")).toHaveLength(2)
    expect(requests.filter((url) => url.pathname === "/lawService.do")).toHaveLength(2)
  })
})
