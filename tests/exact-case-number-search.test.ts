import { afterEach, describe, expect, it } from "vitest"
import { CitationVerifier } from "../src/providers/law/citation-verifier.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("exact precedent docket lookup", () => {
  it.each(["2024다12345", " 2024 다 12345 "])(
    "finds a generic-titled case through the exact docket parameter: %s",
    async (query) => {
      // Given
      const requests: URLSearchParams[] = []
      const api = await startFakeLawApi((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        requests.push(url.searchParams)
        const found = url.searchParams.get("nb") === "2024다12345" && !url.searchParams.has("query")
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            PrecSearch: {
              totalCnt: found ? "1" : "0",
              prec: found
                ? [{ 판례일련번호: "case-one", 사건명: "물품대금", 사건번호: "2024다12345" }]
                : [],
            },
          }),
        )
      })
      apis.push(api)
      const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
      // When
      const result = await provider.search({ query, types: ["precedent"] })
      // Then
      expect(result.results[0]?.documentId).toBe("case-one")
      expect(requests[0]?.get("nb")).toBe("2024다12345")
      expect(requests[0]?.has("query")).toBe(false)
    },
  )

  it("uses the exact docket lookup when verifying a precedent citation", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      const found = url.searchParams.get("nb") === "2024다12345" && !url.searchParams.has("query")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          PrecSearch: {
            totalCnt: found ? "1" : "0",
            prec: found
              ? [{ 판례일련번호: "case-one", 사건명: "물품대금", 사건번호: "2024다12345" }]
              : [],
          },
        }),
      )
    })
    apis.push(api)
    const verifier = new CitationVerifier(
      new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 }),
    )
    // When
    const result = await verifier.verify(["대법원 2024다12345"])
    // Then
    expect(result[0]).toMatchObject({
      status: "VERIFIED",
      documentId: "case-one",
      verificationScope: "case_identity",
    })
  })

  it("keeps different explicit dockets separate in the list cache", async () => {
    // Given
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      const docket = url.searchParams.get("nb")
      response.setHeader("content-type", "application/json")
      response.end(
        JSON.stringify({
          PrecSearch: {
            totalCnt: docket && !url.searchParams.has("query") ? "1" : "0",
            prec:
              docket && !url.searchParams.has("query")
                ? [{ 판례일련번호: docket, 사건명: "물품대금", 사건번호: docket }]
                : [],
          },
        }),
      )
    })
    apis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    await provider.search({ query: "지체상금", caseNumber: "2024다12345", types: ["precedent"] })
    // When
    const result = await provider.search({
      query: "지체상금",
      caseNumber: "2024 다 12346",
      types: ["precedent"],
    })
    // Then
    expect(result.results[0]?.documentId).toBe("2024다12346")
  })

  it.each(["2024다12345 판례", "판례 2024다12345", "2024다123456789", "202다12345"])(
    "preserves ordinary query semantics for non-standalone docket input: %s",
    async (query) => {
      // Given
      const requests: URLSearchParams[] = []
      const api = await startFakeLawApi((request, response) => {
        const url = new URL(request.url ?? "/", "http://localhost")
        requests.push(url.searchParams)
        response.setHeader("content-type", "application/json")
        response.end(JSON.stringify({ PrecSearch: { totalCnt: "0", prec: [] } }))
      })
      apis.push(api)
      const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
      // When
      await provider.search({ query, types: ["precedent"] })
      // Then
      expect(requests[0]?.get("query")).toBe(query)
      expect(requests[0]?.has("nb")).toBe(false)
    },
  )

  it("preserves constitutional query requests without sending the precedent-only parameter", async () => {
    // Given
    const requests: URLSearchParams[] = []
    const api = await startFakeLawApi((request, response) => {
      const url = new URL(request.url ?? "/", "http://localhost")
      requests.push(url.searchParams)
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ DetcSearch: { totalCnt: "0", Detc: [] } }))
    })
    apis.push(api)
    const provider = new LawProvider({ apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 })
    // When
    await provider.search({
      query: "89헌가104",
      caseNumber: "89헌가104",
      types: ["constitutional_case"],
    })
    // Then
    expect(requests[0]?.get("query")).toBe("89헌가104")
    expect(requests[0]?.has("nb")).toBe(false)
  })
})
