import { afterEach, describe, expect, it } from "vitest"
import { LawApiProvider } from "../src/providers/law/law-api-provider.js"
import { koreaToday } from "../src/providers/law/law-api-temporal.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("shared effective-date policy", () => {
  it("excludes deferred articles from today's structured proof while retaining the official raw body", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.end(
        JSON.stringify(
          url.pathname === "/lawSearch.do"
            ? {
                LawSearch: {
                  totalCnt: "1",
                  law: { 법령일련번호: "1", 법령명한글: "방위사업법", 시행일자: "20200101" },
                },
              }
            : {
                법령: {
                  기본정보: { 법령명_한글: "방위사업법", 법령ID: "10107" },
                  조문: {
                    조문단위: [
                      { 조문번호: "1", 조문내용: "현행 내용", 조문시행일자: "20200101" },
                      { 조문번호: "2", 조문내용: "미래 내용", 조문시행일자: "20990101" },
                    ],
                  },
                },
              },
        ),
      )
    })
    apis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    await provider.search({ query: "방위사업법" })
    // When
    const response = await provider.getDetail({ documentId: "1", sourceType: "law" })
    // Then
    expect(response.detail?.articles.map((article) => article.articleNumber)).toEqual(["1"])
    expect(response.results[0]?.content).toContain("미래 내용")
  })

  it("keeps the still-effective administrative version when a replacement is not yet in force", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const nw = new URL(request.url ?? "/", "http://localhost").searchParams.get("nw")
      response.end(
        JSON.stringify({
          AdmRulSearch: {
            totalCnt: "1",
            admrul: {
              행정규칙일련번호: nw === "1" ? "future" : "active",
              행정규칙ID: "38163",
              행정규칙명: "방위사업관리규정",
              현행연혁구분: nw === "1" ? "현행" : "연혁",
              시행일자: nw === "1" ? "20990101" : "20200101",
            },
          },
        }),
      )
    })
    apis.push(api)
    // When
    const result = await new LawProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
    }).search({ query: "방위사업관리규정", types: ["administrative_rule"] })
    // Then
    expect(result.results.map((item) => item.documentId)).toEqual(["active"])
    expect(result.results[0]?.status).toBe("current")
  })

  it("uses Korea's calendar day across the UTC midnight boundary", () => {
    // Given
    const now = new Date("2026-10-05T15:00:00.000Z")
    // When
    const day = koreaToday(now)
    // Then
    expect(day).toBe("2026-10-06")
  })

  it.each(["specialized", "generic"] as const)(
    "requests effective current law in %s list",
    async (path) => {
      // Given
      const requests: URL[] = []
      const api = await startFakeLawApi((request, response) => {
        requests.push(new URL(request.url ?? "/", "http://localhost"))
        response.end(
          JSON.stringify({
            LawSearch: {
              totalCnt: "1",
              law: {
                법령일련번호: "1",
                법령명한글: "방위사업법",
                현행연혁코드: "현행",
                시행일자: "20200101",
              },
            },
          }),
        )
      })
      apis.push(api)
      const config = { apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }
      // When
      if (path === "specialized") await new LawProvider(config).search({ query: "방위사업법" })
      else await new LawApiProvider(config).query({ apiId: "law.list", query: "방위사업법" })
      // Then
      expect(requests[0]?.searchParams.get("target")).toBe("eflaw")
      expect(requests[0]?.searchParams.get("nw")).toBe("3")
    },
  )

  it.each(["specialized", "generic"] as const)(
    "queries both current and historical administrative rules in %s all scope",
    async (path) => {
      // Given
      const categories: string[] = []
      const api = await startFakeLawApi((request, response) => {
        const nw =
          new URL(request.url ?? "/", "http://localhost").searchParams.get("nw") ?? "missing"
        categories.push(nw)
        response.end(
          JSON.stringify({
            AdmRulSearch: {
              totalCnt: "1",
              admrul: {
                행정규칙일련번호: nw,
                행정규칙명: "방위사업관리규정",
                현행연혁구분: nw === "1" ? "현행" : "연혁",
              },
            },
          }),
        )
      })
      apis.push(api)
      const config = { apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }
      // When
      const result =
        path === "specialized"
          ? await new LawProvider(config).search({
              query: "규정",
              types: ["administrative_rule"],
              currentOnly: false,
            })
          : await new LawApiProvider(config).query({
              apiId: "administrative_rule.list",
              query: "규정",
              currentOnly: false,
            })
      // Then
      expect(categories.sort()).toEqual(["1", "2"])
      expect(result.status).toBe("OK")
    },
  )

  it.each(["specialized", "generic"] as const)(
    "resolves an old law master to today's effective official version in %s body",
    async (path) => {
      // Given
      const requests: URL[] = []
      const api = await startFakeLawApi((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        requests.push(url)
        if (url.pathname === "/lawSearch.do") {
          response.end(
            JSON.stringify({
              LawSearch: {
                totalCnt: "1",
                law: {
                  법령일련번호: "new",
                  법령명한글: "방위사업법",
                  법령ID: "10107",
                  현행연혁코드: "현행",
                  시행일자: "20200101",
                },
              },
            }),
          )
          return
        }
        response.end(
          JSON.stringify({
            법령: {
              기본정보: {
                법령ID: "10107",
                법령명_한글: "방위사업법",
                시행일자: url.searchParams.get("MST") === "old" ? "20100101" : "20200101",
              },
              조문: {
                조문단위: [
                  {
                    조문번호: "1",
                    조문내용: url.searchParams.get("MST") === "old" ? "과거 내용" : "현행 내용",
                  },
                ],
              },
            },
          }),
        )
      })
      apis.push(api)
      // When
      const config = { apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }
      const result =
        path === "specialized"
          ? await new LawProvider(config).getDetail({ documentId: "old", sourceType: "law" })
          : await new LawApiProvider(config).resolveBody({ apiId: "law.list", documentId: "old" })
      // Then
      if ("results" in result) {
        expect(result.results[0]?.documentId).toBe("new")
        expect(result.detail?.articles[0]?.text).toBe("현행 내용")
      } else {
        expect(JSON.stringify(result.data)).toContain("현행 내용")
        expect(JSON.stringify(result.data)).not.toContain("과거 내용")
      }
      expect(
        requests.some(
          (url) => url.searchParams.get("target") === "eflaw" && url.searchParams.get("nw") === "3",
        ),
      ).toBe(true)
    },
  )
})
