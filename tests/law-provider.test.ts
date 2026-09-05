import { afterEach, describe, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("LawProvider", () => {
  it("does not start an upstream request after the caller deadline", async () => {
    // Given
    let requestCount = 0
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ LawSearch: { totalCnt: "0", law: [] } }))
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({ query: "방위사업", deadlineAt: 0 })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("TIMEOUT")
    expect(requestCount).toBe(0)
  })

  it("coalesces the same concurrent search requested by multiple employees", async () => {
    // Given
    let requestCount = 0
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "1",
            law: [{ 법령일련번호: "1", 법령명한글: "방위사업법", 현행연혁코드: "현행" }],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const results = await Promise.all(
      Array.from({ length: 20 }, () => provider.search({ query: "방위사업법", types: ["law"] })),
    )

    // Then
    expect(results.every((result) => result.status === "OK")).toBe(true)
    expect(requestCount).toBe(1)
  })
  it.each([
    [
      "interpretation",
      {
        Expc: {
          totalCnt: "1",
          expc: [
            {
              법령해석례일련번호: "313001",
              안건명: "방위사업 해석",
              해석기관명: "법제처",
              회신일자: "20260102",
            },
          ],
        },
      },
    ],
    [
      "administrative_appeal",
      {
        Decc: {
          totalCnt: "1",
          decc: [
            {
              행정심판재결례일련번호: "412001",
              사건명: "방위사업 재결",
              재결청: "중앙행정심판위원회",
              의결일자: "20260103",
            },
          ],
        },
      },
    ],
  ] as const)(
    "maps the %s search envelope returned by the official API",
    async (sourceType, body) => {
      // Given
      const api = await startFakeLawApi((_request, response) => {
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify(body))
      })
      openApis.push(api)
      const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

      // When
      const result = await provider.search({ query: "방위사업", types: [sourceType], limit: 5 })

      // Then
      expect(result.status).toBe("OK")
      expect(result.results[0]?.sourceType).toBe(sourceType)
      expect(result.results[0]?.documentId).toMatch(/^(313001|412001)$/u)
    },
  )

  it("maps an official law search response to the unified schema", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            target: "law",
            totalCnt: "1",
            law: [
              {
                법령일련번호: "276787",
                현행연혁코드: "현행",
                법령명한글: "방위사업법",
                법령ID: "009822",
                공포일자: "20260102",
                시행일자: "20260701",
                소관부처명: "방위사업청",
                법령구분명: "법률",
                법령상세링크: "/DRF/lawService.do?OC=secret-value&target=eflaw&MST=276787",
              },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({ query: "방위사업법", types: ["law"], limit: 5 })

    // Then
    expect(result.status).toBe("OK")
    expect(result.results[0]).toMatchObject({
      id: "276787",
      sourceType: "law",
      title: "방위사업법",
      organization: "방위사업청",
      effectiveDate: "2026-07-01",
      status: "current",
      verified: true,
      documentId: "276787",
    })
    expect(result.results[0]?.sourceUrl).not.toContain("OC=")
  })

  it("returns NOT_FOUND only when the official response explicitly reports zero results", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ LawSearch: { target: "law", totalCnt: "0", law: [] } }))
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({ query: "없는법령", types: ["law"] })

    // Then
    expect(result.status).toBe("NOT_FOUND")
    expect(result.errors).toEqual([])
  })

  it.each([
    [429, "RATE_LIMITED"],
    [500, "SOURCE_UNAVAILABLE"],
    [503, "SOURCE_UNAVAILABLE"],
  ] as const)("does not convert HTTP %i into NOT_FOUND", async (status, errorCode) => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.statusCode = status
      response.end("upstream failure")
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({ query: "방위사업법", types: ["law"] })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe(errorCode)
  })

  it("does not convert malformed JSON into NOT_FOUND", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end("{broken")
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({ query: "방위사업법", types: ["law"] })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
  })

  it("masks OC when an upstream source URL cannot be parsed", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "1",
            law: {
              법령일련번호: "276787",
              법령명한글: "방위사업법",
              법령상세링크: "https://[invalid]?OC=secret-value",
            },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({ query: "방위사업법" })

    // Then
    expect(result.status).toBe("OK")
    expect(result.results[0]?.sourceUrl).not.toContain("secret-value")
  })

  it("does not convert an unexpected XML body into NOT_FOUND", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/xml")
      response.end("<LawSearch><totalCnt>0</totalCnt></LawSearch>")
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({ query: "방위사업법", types: ["law"] })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
  })

  it("reports a timed-out upstream request without returning NOT_FOUND", async () => {
    // Given
    const api = await startFakeLawApi(() => undefined)
    openApis.push(api)
    const provider = new LawProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
      timeoutMs: 20,
    })

    // When
    const result = await provider.search({ query: "방위사업법", types: ["law"] })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("TIMEOUT")
  })

  it("reuses a successful official response from the TTL cache", async () => {
    // Given
    let requestCount = 0
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            target: "law",
            totalCnt: "1",
            law: [{ 법령일련번호: "1", 법령명한글: "방위사업법", 현행연혁코드: "현행" }],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    await provider.search({ query: "방위사업법", types: ["law"] })
    const result = await provider.search({ query: "방위사업법", types: ["law"] })

    // Then
    expect(result.status).toBe("OK")
    expect(requestCount).toBe(1)
  })

  it("bypasses the TTL cache when forceRefresh is requested", async () => {
    // Given
    let requestCount = 0
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            target: "law",
            totalCnt: "1",
            law: [{ 법령일련번호: "1", 법령명한글: "방위사업법", 현행연혁코드: "현행" }],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    await provider.search({ query: "방위사업법", types: ["law"], forceRefresh: true })
    await provider.search({ query: "방위사업법", types: ["law"], forceRefresh: true })

    // Then
    expect(requestCount).toBe(2)
  })

  it("filters explicit historical and repealed administrative rules by default", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          AdmRulSearch: {
            target: "admrul",
            totalCnt: "3",
            admrul: [
              { 행정규칙일련번호: "1", 행정규칙명: "현행규정", 현행연혁코드: "현행" },
              { 행정규칙일련번호: "2", 행정규칙명: "과거규정", 현행연혁코드: "연혁" },
              { 행정규칙일련번호: "3", 행정규칙명: "폐지규정", 현행연혁코드: "폐지" },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const current = await provider.search({
      query: "규정",
      types: ["administrative_rule"],
      currentOnly: true,
    })
    const all = await provider.search({
      query: "규정",
      types: ["administrative_rule"],
      currentOnly: false,
      forceRefresh: true,
    })

    // Then
    expect(current.results.map((result) => result.status)).toEqual(["current"])
    expect(all.results.map((result) => result.status)).toEqual([
      "current",
      "historical",
      "repealed",
    ])
  })

  it("passes a specific effective-date range to the historical law search target", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.searchParams.get("target")).toBe("eflaw")
      expect(url.searchParams.get("efYd")).toBe("20210101~20210101")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            target: "eflaw",
            totalCnt: "1",
            law: [
              {
                법령일련번호: "225201",
                법령명한글: "방위사업법",
                현행연혁코드: "연혁",
                시행일자: "20210101",
              },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({
      query: "방위사업법",
      types: ["law"],
      asOfDate: "2021-01-01",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.results[0]).toMatchObject({ documentId: "225201", status: "historical" })
  })

  it("parses the law history HTML response into ordered versions", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      expect(url.searchParams.get("target")).toBe("lsHistory")
      response.setHeader("content-type", "text/html")
      response.end(`
        <html><strong>2</strong> 건
          <table>
            <tr><td>2025.12.30</td><td>2026.07.01</td><td>제21242호</td><td>일부개정</td><td><a href="/DRF/lawService.do?MST=281867&amp;efYd=20260701">방위사업법</a></td></tr>
            <tr><td>2020.12.29</td><td>2021.01.01</td><td>제17646호</td><td>일부개정</td><td><a href="/DRF/lawService.do?MST=225201&amp;efYd=20210101">방위사업법</a></td></tr>
          </table>
        </html>
      `)
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getHistory({ lawName: "방위사업법", limit: 10 })

    // Then
    expect(result.status).toBe("OK")
    expect(result.totalCount).toBe(2)
    expect(result.versions.map((version) => version.documentId)).toEqual(["281867", "225201"])
  })

  it("parses history links when effective date precedes document ID", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "text/html")
      response.end(`
        <html><strong>1</strong> 건
          <table>
            <tr><td>2021.01.01</td><td><a href="/DRF/lawService.do?efYd=20210101&amp;MST=225201"><span>방위사업법</span></a></td></tr>
          </table>
        </html>
      `)
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getHistory({ lawName: "방위사업법", limit: 10 })

    // Then
    expect(result.status).toBe("OK")
    expect(result.totalCount).toBe(1)
    expect(result.versions[0]?.documentId).toBe("225201")
  })

  it("reports source unavailable when history count is nonzero but rows are unparseable", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "text/html")
      response.end("<html><strong>2</strong> 건<table><tr><td>불완전한 행</td></tr></table></html>")
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getHistory({ lawName: "방위사업법", limit: 10 })

    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.totalCount).toBe(2)
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
  })

  it("reports an unconfigured key without making a request", async () => {
    // Given
    const provider = new LawProvider({})

    // When
    const result = await provider.search({ query: "방위사업법", types: ["law"] })

    // Then
    expect(provider.health()).toBe("not_configured")
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.errors[0]?.code).toBe("AUTH_REQUIRED")
  })

  it("returns PARTIAL_RESULT when one requested official source fails", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const target = new URL(request.url ?? "/", "http://localhost").searchParams.get("target")
      if (target === "prec") {
        response.statusCode = 503
        response.end("unavailable")
        return
      }
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawSearch: {
            target: "law",
            totalCnt: "1",
            law: [{ 법령일련번호: "1", 법령명한글: "방위사업법", 현행연혁코드: "현행" }],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({
      query: "방위사업",
      types: ["law", "precedent"],
    })

    // Then
    expect(result.status).toBe("PARTIAL_RESULT")
    expect(result.results).toHaveLength(1)
    expect(result.errors[0]?.code).toBe("SOURCE_UNAVAILABLE")
  })
})
