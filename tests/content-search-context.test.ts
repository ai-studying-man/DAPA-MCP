import { afterEach, describe, expect, it } from "vitest"
import { searchLegalContent } from "../src/providers/law/content-search.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("defense-first substantive content", () => {
  it("rejects an agency-only body for a contract question", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify(
          url.pathname === "/lawSearch.do"
            ? {
                AdmRulSearch: {
                  totalCnt: "1",
                  admrul: [
                    {
                      행정규칙일련번호: "1",
                      행정규칙명: "조직관리 지침",
                      소관부처명: "방위사업청",
                    },
                  ],
                },
              }
            : {
                AdmRulService: {
                  행정규칙기본정보: { 행정규칙명: "조직관리 지침" },
                  조문내용: ["제1조 방위사업청 조직 운영 사항"],
                },
              },
        ),
      )
    })
    apis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    // When
    const result = await searchLegalContent(law, {
      query: "방위사업청에서 중도확정계약을 알려줘",
      types: ["administrative_rule"],
      limit: 1,
    })
    // Then
    expect(result.results[0]?.match).toBe("metadata")
    expect(result.results[0]?.detail).toBeUndefined()
    expect(result.results[0]?.excerpts).toBeUndefined()
  })

  it("presents a matching defense rule before an unrelated exact title with more clauses", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      response.setHeader("content-type", "application/json")
      const dapa = url.searchParams.get("ID") === "dapa"
      response.end(
        JSON.stringify(
          url.pathname === "/lawSearch.do"
            ? {
                AdmRulSearch: {
                  totalCnt: "2",
                  admrul: [
                    { 행정규칙일련번호: "other", 행정규칙명: "시험평가", 소관부처명: "타기관" },
                    {
                      행정규칙일련번호: "dapa",
                      행정규칙명: "획득업무 지침",
                      소관부처명: "방위사업청",
                    },
                  ],
                },
              }
            : {
                AdmRulService: {
                  행정규칙기본정보: { 행정규칙명: dapa ? "획득업무 지침" : "시험평가" },
                  조문내용: dapa
                    ? ["제1조 시험평가 적용 기준"]
                    : ["제1조 시험평가", "제2조 시험평가", "제3조 시험평가"],
                },
              },
        ),
      )
    })
    apis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    // When
    const result = await searchLegalContent(law, {
      query: "시험평가",
      types: ["administrative_rule"],
    })
    // Then
    expect(result.results.map(({ document }) => document.documentId)).toEqual(["dapa", "other"])
    expect(result.results.every(({ match }) => match === "content")).toBe(true)
  })
})
