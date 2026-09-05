import { afterEach, describe, expect, it } from "vitest"
import { searchLegalContent } from "../src/providers/law/content-search.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("searchLegalContent for case materials", () => {
  it("returns matching official excerpts for a precedent body search", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        response.end(
          JSON.stringify({
            PrecSearch: {
              totalCnt: "1",
              prec: [{ 판례일련번호: "240941", 사건명: "입찰참가자격제한처분취소" }],
            },
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          PrecService: {
            사건명: "입찰참가자격제한처분취소",
            판시사항: "방위사업청의 입찰참가자격 제한 기준에 관한 판단",
            판결요지: "관련 없는 요지",
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await searchLegalContent(law, {
      query: "방위사업청 입찰참가자격",
      types: ["precedent"],
      limit: 5,
      mode: "fast",
    })

    // Then
    expect(result.results[0]?.match).toBe("content")
    expect(result.results[0]?.excerpts).toEqual(["방위사업청의 입찰참가자격 제한 기준에 관한 판단"])
  })

  it("prioritizes an exact named rule before hydrating broad body matches", async () => {
    // Given
    const searches: { readonly query: string; readonly scope: string | null }[] = []
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        searches.push({
          query: url.searchParams.get("query") ?? "",
          scope: url.searchParams.get("search"),
        })
        response.end(
          JSON.stringify({
            AdmRulSearch: {
              totalCnt: "6",
              admrul: Array.from({ length: 6 }, (_, index) => ({
                행정규칙일련번호: String(index + 1),
                행정규칙명: index === 5 ? "방위사업관리규정" : `사업관리 후보 ${index + 1}`,
                소관부처명: "방위사업청",
              })),
            },
          }),
        )
        return
      }
      const documentId = url.searchParams.get("ID") ?? ""
      response.end(
        JSON.stringify({
          AdmRulService: {
            행정규칙기본정보: {
              행정규칙명: documentId === "6" ? "방위사업관리규정" : `후보 ${documentId}`,
            },
            조문내용:
              documentId === "6"
                ? [
                    "제1조(목적) 이 규정의 명칭은 방위사업관리규정이다.",
                    "제2조(예산편성) 예산편성의 근거를 정한다.",
                  ]
                : ["제1조 일반사항"],
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await searchLegalContent(law, {
      query: "방위사업관리규정 예산편성",
      types: ["administrative_rule"],
      limit: 5,
      mode: "fast",
    })

    // Then
    expect(searches).toContainEqual({ query: "예산편성", scope: "2" })
    expect(searches).toContainEqual({ query: "방위사업관리규정", scope: null })
    expect(result.results[0]).toMatchObject({
      match: "content",
      document: { documentId: "6", title: "방위사업관리규정" },
      detail: { articles: [{ articleNumber: "2" }] },
    })
  })

  it("ranks a primary issue match ahead of several secondary-term matches", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        response.end(
          JSON.stringify({
            AdmRulSearch: {
              totalCnt: "2",
              admrul: [
                { 행정규칙일련번호: "primary", 행정규칙명: "방위사업관리규정" },
                { 행정규칙일련번호: "secondary", 행정규칙명: "일반 후속조치 규정" },
              ],
            },
          }),
        )
        return
      }
      const documentId = url.searchParams.get("ID") ?? ""
      response.end(
        JSON.stringify({
          AdmRulService: {
            행정규칙기본정보: { 행정규칙명: documentId },
            조문내용:
              documentId === "primary"
                ? ["제1조 야전운용시험을 지원한다."]
                : ["제1조 후속조치", "제2조 후속조치", "제3조 후속조치"],
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await searchLegalContent(law, {
      query: "야전운용시험 후속조치",
      types: ["administrative_rule"],
      mode: "fast",
      limit: 5,
    })

    // Then
    expect(result.results[0]?.document.documentId).toBe("primary")
  })

  it("keeps a closer matching title ahead of a narrower document with more matches", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        response.end(
          JSON.stringify({
            AdmRulSearch: {
              totalCnt: "2",
              admrul: [
                { 행정규칙일련번호: "narrow", 행정규칙명: "절충교역 자산 징수 고시" },
                { 행정규칙일련번호: "general", 행정규칙명: "절충교역 지침" },
              ],
            },
          }),
        )
        return
      }
      const id = url.searchParams.get("ID") ?? ""
      response.end(
        JSON.stringify({
          AdmRulService: {
            행정규칙기본정보: { 행정규칙명: id },
            조문내용:
              id === "narrow"
                ? ["제1조 절충교역 자산", "제2조 절충교역 징수"]
                : ["제1조 절충교역 일반 기준"],
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await searchLegalContent(law, {
      query: "절충교역",
      types: ["administrative_rule"],
      mode: "fast",
    })

    // Then
    expect(result.results[0]?.document.documentId).toBe("general")
  })

  it("does not treat an upstream menu placeholder as official body evidence", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        response.end(
          JSON.stringify({
            PrecSearch: {
              totalCnt: "1",
              prec: [{ 판례일련번호: "placeholder", 사건명: "절충교역 안내" }],
            },
          }),
        )
        return
      }
      response.end(
        JSON.stringify({
          PrecService: {
            사건명: "절충교역 안내",
            판시사항:
              '절충교역의 자세한 내용은 상단 메뉴 "<img id="40425753"></img>"버튼을 이용하십시오.',
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await searchLegalContent(law, {
      query: "절충교역",
      types: ["precedent"],
      mode: "fast",
    })

    // Then
    expect(result.results[0]?.match).toBe("metadata")
    expect(result.results[0]?.excerpts).toBeUndefined()
  })
})
