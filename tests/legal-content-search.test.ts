import { afterEach, describe, expect, it } from "vitest"
import { searchLegalContent } from "../src/providers/law/content-search.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("searchLegalContent", () => {
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
            조문: { 조문단위: [{ 조문번호: "3", 조문내용: "정의 본문" }] },
          },
        }),
      )
    })
    openApis.push(api)
    const law = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const response = await searchLegalContent(law, {
      query: "방위사업법",
      types: ["law"],
      limit: 5,
    })

    // Then
    expect(response.status).toBe("OK")
    expect(response.results[0]?.document.documentId).toBe("276787")
    expect(response.results[0]?.detail?.articles[0]?.text).toBe("정의 본문")
  })
})
