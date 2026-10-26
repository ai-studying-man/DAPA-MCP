import { afterEach, describe, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("official effective body fallback", () => {
  it.each([
    ["20200101", "OK", false],
    ["20210101", "SOURCE_UNAVAILABLE", false],
    ["20200101", "OK", true],
    ["20210101", "SOURCE_UNAVAILABLE", true],
  ])(
    "uses only the same official version after an effective endpoint 404: %s",
    async (bodyDate, expected, timeout) => {
      // Given
      const api = await startFakeLawApi((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        response.setHeader("content-type", "application/json")
        if (url.pathname === "/lawSearch.do") {
          response.end(
            JSON.stringify({
              LawSearch: {
                totalCnt: "1",
                law: [
                  {
                    법령일련번호: "1",
                    법령ID: "010107",
                    법령명한글: "방위사업법",
                    시행일자: "20200101",
                    현행연혁코드: "현행",
                  },
                ],
              },
            }),
          )
        } else if (url.searchParams.get("target") === "eflaw") {
          if (timeout) return
          response.statusCode = 404
          response.end("{}")
        } else {
          response.end(
            JSON.stringify({
              법령: {
                기본정보: { 법령명_한글: "방위사업법", 법령ID: "010107", 시행일자: bodyDate },
                조문: { 조문단위: [{ 조문번호: "3", 조문내용: "제3조(정의) 군수품" }] },
              },
            }),
          )
        }
      })
      apis.push(api)
      const law = new LawProvider({
        apiKey: "test",
        baseUrl: api.baseUrl,
        retryLimit: 0,
        timeoutMs: timeout ? 100 : 1000,
      })
      await law.search({ query: "방위사업법", types: ["law"] })
      // When
      const result = await law.getDetail({ documentId: "1", sourceType: "law" })
      // Then
      expect({ status: result.status, errors: result.errors }).toMatchObject({
        status: expected,
        ...(expected === "OK" ? { errors: [] } : {}),
      })
    },
  )
})
