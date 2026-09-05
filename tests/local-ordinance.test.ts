import { afterEach, describe, expect, it } from "vitest"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const openApis: FakeLawApi[] = []

afterEach(async () => {
  await Promise.all(openApis.splice(0).map((api) => api.close()))
})

describe("LawProvider local ordinances", () => {
  it("searches current local ordinances through the official ordin target", async () => {
    // Given
    let requestedTarget = ""
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      requestedTarget = url.searchParams.get("target") ?? ""
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          OrdinSearch: {
            totalCnt: "1",
            law: [
              {
                자치법규일련번호: "1316146",
                자치법규명: "서울특별시 방위산업 육성 조례",
                지자체기관명: "서울특별시",
                현행연혁코드: "현행",
              },
            ],
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.search({ query: "방위산업", types: ["local_ordinance"] })

    // Then
    expect(result.results[0]).toMatchObject({
      sourceType: "local_ordinance",
      title: "서울특별시 방위산업 육성 조례",
      organization: "서울특별시",
    })
    expect(requestedTarget).toBe("ordin")
  })

  it("retrieves local-ordinance articles by the official master number", async () => {
    // Given
    let requestedMaster = ""
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      requestedMaster = url.searchParams.get("MST") ?? ""
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          LawService: {
            자치법규기본정보: {
              자치법규명: "서울특별시 방위산업 육성 조례",
              자치법규ID: "2251458",
              자치법규일련번호: "1316146",
              지자체기관명: "서울특별시",
              시행일자: "20260101",
            },
            조문: {
              조: [
                {
                  조문번호: ["000300", "000300"],
                  조제목: "지원사업",
                  조내용: "제3조(지원사업) 지방자치단체는 지원할 수 있다.",
                },
              ],
            },
          },
        }),
      )
    })
    openApis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })

    // When
    const result = await provider.getDetail({
      documentId: "1316146",
      sourceType: "local_ordinance",
    })

    // Then
    expect(result.status).toBe("OK")
    expect(result.detail?.articles[0]).toMatchObject({
      articleNumber: "3",
      title: "지원사업",
      text: "제3조(지원사업) 지방자치단체는 지원할 수 있다.",
    })
    expect(requestedMaster).toBe("1316146")
  })
})
