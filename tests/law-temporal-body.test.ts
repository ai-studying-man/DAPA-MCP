import { afterEach, describe, expect, it } from "vitest"
import { LawApiProvider } from "../src/providers/law/law-api-provider.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("effective body safeguards", () => {
  it("rejects a future-dated body when the current administrative list omitted its effective date", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.end(
        JSON.stringify(
          url.pathname === "/lawSearch.do"
            ? {
                AdmRulSearch: {
                  totalCnt: "1",
                  admrul: {
                    행정규칙일련번호: "1",
                    행정규칙ID: "38163",
                    행정규칙명: "방위사업관리규정",
                    현행연혁구분: "현행",
                  },
                },
              }
            : {
                AdmRulService: {
                  행정규칙기본정보: {
                    행정규칙일련번호: "1",
                    행정규칙ID: "38163",
                    행정규칙명: "방위사업관리규정",
                    시행일자: "20990101",
                  },
                  조문내용: ["제1조(목적) 미래 내용"],
                },
              },
        ),
      )
    })
    apis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    await provider.search({ query: "방위사업관리규정", types: ["administrative_rule"] })
    // When
    const result = await provider.getDetail({ documentId: "1", sourceType: "administrative_rule" })
    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
  })

  it("does not identify a replacement's previous version by title alone", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const nw = new URL(request.url ?? "/", "http://localhost").searchParams.get("nw")
      response.end(
        JSON.stringify({
          AdmRulSearch: {
            totalCnt: "1",
            admrul: {
              행정규칙일련번호: nw === "1" ? "future" : "other-agency",
              행정규칙명: "계약관리규정",
              ...(nw === "1" ? {} : { 행정규칙ID: "other" }),
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
    }).search({ query: "계약관리규정", types: ["administrative_rule"] })
    // Then
    expect(result.status).toBe("SOURCE_UNAVAILABLE")
    expect(result.results).toEqual([])
  })

  it("retains upstream total count when filtering the returned current page", async () => {
    // Given
    const api = await startFakeLawApi((_request, response) =>
      response.end(
        JSON.stringify({
          LawSearch: {
            totalCnt: "50",
            law: {
              법령일련번호: "future",
              법령명한글: "방위사업법",
              시행일자: "20990101",
              현행연혁코드: "현행",
            },
          },
        }),
      ),
    )
    apis.push(api)
    // When
    const result = await new LawApiProvider({
      apiKey: "test",
      baseUrl: api.baseUrl,
      retryLimit: 0,
    }).query({ apiId: "law.list", query: "방위사업법" })
    // Then
    expect(result.status).toBe("NOT_FOUND")
    expect(result.data).toMatchObject({ LawSearch: { totalCnt: "50", returnedCount: 0, law: [] } })
  })
})
