import { afterEach, describe, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("LawHttpClient usable-response retry", () => {
  it("retries a transient HTML response before parsing official JSON", async () => {
    // Given
    let requestCount = 0
    const api = await startFakeLawApi((_request, response) => {
      requestCount += 1
      if (requestCount === 1) {
        response.setHeader("content-type", "application/javascript")
        response.end("<script>location.assign('/temporary-check')</script>")
        return
      }
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          법령: {
            기본정보: { 법령명_한글: "방위사업법" },
            조문: { 조문단위: [{ 조문번호: "1", 조문내용: "목적" }] },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 1 })

    // When
    const result = await provider.getDetail({ documentId: "276787", sourceType: "law" })

    // Then
    expect(result.status).toBe("OK")
    expect(requestCount).toBe(2)
  })
})
