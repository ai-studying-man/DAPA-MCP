import { afterEach, describe, expect, it } from "vitest"
import { searchLegalContent } from "../src/providers/law/content-search.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("searchLegalContent", () => {
  it("passes one total deadline from list search through detail hydration", async () => {
    // Given
    const deadlines: number[] = []
    const law = {
      search: async (input: { readonly deadlineAt?: number }) => {
        deadlines.push(input.deadlineAt ?? 0)
        return {
          status: "OK" as const,
          results: [
            {
              id: "law:1",
              source: "국가법령정보 공동활용 Open API",
              sourceType: "law" as const,
              documentId: "1",
              title: "방위사업법",
              status: "current" as const,
              verified: true,
              retrievedAt: new Date().toISOString(),
              sourceUrl: "https://www.law.go.kr/법령/방위사업법",
            },
          ],
          errors: [],
        }
      },
      getDetail: async (input: { readonly deadlineAt?: number }) => {
        deadlines.push(input.deadlineAt ?? 0)
        return { status: "NOT_FOUND" as const, results: [], errors: [] }
      },
    }

    // When
    await searchLegalContent(law, { query: "방위사업법", types: ["law"], timeBudgetMs: 5_000 })

    // Then
    expect(deadlines.length).toBeGreaterThan(1)
    expect(new Set(deadlines).size).toBe(1)
    expect(deadlines[0]).toBeGreaterThan(Date.now())
  })

  it("hydrates API search candidates with their official article bodies", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        response.end(
          JSON.stringify({
            LawSearch: {
              totalCnt: "1",
              law: [{ 법령일련번호: "276787", 법령명한글: "방위사업법", 현행연혁코드: "현행" }],
            },
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          법령: {
            기본정보: { 법령명_한글: "방위사업법", 시행일자: "20260701" },
            조문: {
              조문단위: [
                { 조문번호: "1", 조문내용: "목적 본문" },
                { 조문번호: "3", 조문내용: "정의 본문" },
              ],
            },
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const response = await searchLegalContent(law, {
      query: "정의",
      types: ["law"],
      limit: 5,
    })

    // Then
    expect(response.status).toBe("OK")
    expect(response.results[0]?.document.documentId).toBe("276787")
    expect(response.results[0]?.detail?.articles).toHaveLength(1)
    expect(response.results[0]?.detail?.articles[0]?.text).toBe("정의 본문")
  })

  it("expands the query, searches multiple pages, and ranks body matches first", async () => {
    // Given
    const searches: string[] = []
    const pages: number[] = []
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        searches.push(url.searchParams.get("query") ?? "")
        pages.push(Number(url.searchParams.get("page") ?? "1"))
        const page = Number(url.searchParams.get("page") ?? "1")
        const query = url.searchParams.get("query") ?? ""
        const item =
          page === 1
            ? { 법령일련번호: "meta", 법령명한글: "시험평가 일반규정", 현행연혁코드: "현행" }
            : query.includes("야전운용시험")
              ? { 법령일련번호: "body", 법령명한글: "국방전력발전업무훈령", 현행연혁코드: "현행" }
              : undefined
        response.end(
          JSON.stringify({
            LawSearch: {
              totalCnt: item === undefined ? "0" : "2",
              law: item === undefined ? [] : [item],
            },
          }),
        )
        return
      }
      const id =
        url.searchParams.get("MST") === "body" ? "국방전력발전업무훈령" : "시험평가 일반규정"
      response.end(
        JSON.stringify({
          법령: {
            기본정보: { 법령명_한글: id },
            조문: {
              조문단위: [
                {
                  조문번호: "1",
                  조문내용: id === "국방전력발전업무훈령" ? "야전운용시험 절차" : "다른 시험 절차",
                },
              ],
            },
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const response = await searchLegalContent(law, {
      query: "야전 운용 시험",
      types: ["law"],
      limit: 5,
      mode: "thorough",
    })

    // Then
    expect(searches).toContain("야전 운용 시험")
    expect(pages).toContain(2)
    expect(response.results[0]?.document.documentId).toBe("body")
    expect(response.results[0]?.match).toBe("content")
  })

  it("uses a small staged request budget for a sentence in fast mode", async () => {
    // Given
    const searches: {
      readonly query: string
      readonly page: number
      readonly searchMode: string | null
    }[] = []
    let detailRequestCount = 0
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        searches.push({
          query: url.searchParams.get("query") ?? "",
          page: Number(url.searchParams.get("page") ?? "1"),
          searchMode: url.searchParams.get("search"),
        })
        response.end(
          JSON.stringify({
            LawSearch: {
              totalCnt: "6",
              law: Array.from({ length: 6 }, (_, index) => ({
                법령일련번호: String(index + 1),
                법령명한글: `후보 ${index + 1}`,
                현행연혁코드: "현행",
              })),
            },
          }),
        )
        return
      }
      detailRequestCount += 1
      const documentId = url.searchParams.get("MST") ?? ""
      const articles =
        documentId === "1"
          ? [{ 조문번호: "1", 조문내용: "야전운용시험의 적용 절차" }]
          : documentId === "2"
            ? [
                { 조문번호: "1", 조문내용: "야전운용시험 계획" },
                { 조문번호: "2", 조문내용: "야전운용시험 후속조치" },
              ]
            : [{ 조문번호: "1", 조문내용: "관련 없는 내용" }]
      response.end(
        JSON.stringify({
          법령: {
            기본정보: { 법령명_한글: `후보 ${documentId}` },
            조문: { 조문단위: articles },
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await searchLegalContent(law, {
      query: "방위사업청에서 야전운용시험을 할 때 적용되는 절차를 알려줘",
      types: ["law"],
      limit: 5,
      mode: "fast",
    })

    // Then
    expect(searches).toEqual([
      { query: "야전운용시험", page: 1, searchMode: "2" },
      {
        query: "방위사업청",
        page: 1,
        searchMode: "2",
      },
    ])
    expect(detailRequestCount).toBe(3)
    expect(result.results).toHaveLength(3)
    expect(result.results[0]?.match).toBe("content")
    expect(result.results[0]?.document.documentId).toBe("2")
  })

  it("does not hydrate a ranked candidate twice when fast mode expands", async () => {
    // Given
    const requestedIds: string[] = []
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        response.end(
          JSON.stringify({
            LawSearch: {
              totalCnt: "6",
              law: Array.from({ length: 6 }, (_, index) => ({
                법령일련번호: String(index + 1),
                법령명한글: `후보 ${index + 1}`,
                소관부처명: index === 3 ? "방위사업청" : "기타",
                현행연혁코드: "현행",
              })),
            },
          }),
        )
        return
      }
      requestedIds.push(url.searchParams.get("MST") ?? "")
      response.end(
        JSON.stringify({
          법령: {
            기본정보: { 법령명_한글: "후보" },
            조문: { 조문단위: [{ 조문번호: "1", 조문내용: "일치하지 않는 본문" }] },
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await searchLegalContent(law, {
      query: "야전운용시험 절차",
      types: ["law"],
      limit: 5,
      mode: "fast",
    })

    // Then
    expect(new Set(requestedIds).size).toBe(requestedIds.length)
    expect(new Set(result.results.map(({ document }) => document.documentId)).size).toBe(5)
    expect(result.results).toHaveLength(5)
  })
})
