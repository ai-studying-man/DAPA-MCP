import { afterEach, describe, expect, it } from "vitest"
import { searchLegalContent } from "../src/providers/law/content-search.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("major defense document routing", () => {
  it("checks both canonical defense rules when field testing is absent from generic discovery", async () => {
    // Given
    const titles = ["방위사업관리규정", "국방전력발전업무훈령"]
    const queries: string[] = []
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      const query = url.searchParams.get("query") ?? ""
      const title = titles.find((value) => value === query)
      response.setHeader("content-type", "application/json")
      if (url.pathname === "/lawSearch.do") {
        queries.push(query)
        response.end(
          JSON.stringify({
            AdmRulSearch: {
              totalCnt: "1",
              admrul: [
                {
                  행정규칙일련번호: title ?? "other",
                  행정규칙명: title ?? "시험 관련 지침",
                  소관부처명: title === titles[1] ? "국방부" : "방위사업청",
                },
              ],
            },
          }),
        )
      } else {
        const id = url.searchParams.get("ID") ?? ""
        response.end(
          JSON.stringify({
            AdmRulService: {
              행정규칙기본정보: { 행정규칙명: id },
              조문내용: ["제1조 야전운용시험 적용 기준"],
            },
          }),
        )
      }
    })
    apis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    // When
    const result = await searchLegalContent(law, {
      query: "야전운용시험은 어떻게 하는 거야?",
      types: ["administrative_rule"],
      limit: 3,
    })
    // Then
    expect(
      result.results
        .filter(({ match }) => match === "content")
        .map(({ document }) => document.title),
    ).toEqual(expect.arrayContaining(titles))
    expect(queries).not.toContain("야전운용시험")
  })

  it("falls back to generic discovery when primary rule bodies do not contain the issue", async () => {
    // Given
    const titles = ["방위사업관리규정", "국방전력발전업무훈령"]
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      const query = url.searchParams.get("query") ?? ""
      const primary = titles.includes(query)
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify(
          url.pathname === "/lawSearch.do"
            ? {
                AdmRulSearch: {
                  totalCnt: "1",
                  admrul: [
                    {
                      행정규칙일련번호: primary ? query : "extra",
                      행정규칙명: primary ? query : "시험 세부 지침",
                      소관부처명: "방위사업청",
                    },
                  ],
                },
              }
            : {
                AdmRulService: {
                  행정규칙기본정보: { 행정규칙명: url.searchParams.get("ID") },
                  조문내용: [
                    url.searchParams.get("ID") === "extra"
                      ? "제1조 야전운용시험 기준"
                      : "제1조 조직 운영",
                  ],
                },
              },
        ),
      )
    })
    apis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    // When
    const result = await searchLegalContent(law, {
      query: "야전운용시험",
      types: ["administrative_rule"],
      limit: 2,
    })
    // Then
    expect(result.results.find(({ match }) => match === "content")?.document.documentId).toBe(
      "extra",
    )
  })
})
