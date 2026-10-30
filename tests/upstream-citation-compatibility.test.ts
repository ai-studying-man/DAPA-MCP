import { afterEach, describe, expect, it } from "vitest"
import { parseCitation } from "../src/lib/citation/parser.js"
import { CitationVerifier } from "../src/providers/law/citation-verifier.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { type FakeLawApi, startFakeLawApi } from "./helpers/fake-law-api.js"

const apis: FakeLawApi[] = []
afterEach(async () => {
  await Promise.all(apis.splice(0).map((api) => api.close()))
})

describe("upstream case citation compatibility", () => {
  it.each([
    ["대법원 2024 두 12345678", "2024두12345678"],
    ["헌법재판소 89 헌가 104", "89헌가104"],
  ])("normalizes spaced case citations: %s", (citation, caseNumber) => {
    // Given / When
    const parsed = parseCitation(citation)
    // Then
    expect(parsed).toMatchObject({ kind: "case", caseNumber })
  })

  it.each(["대법원 2024두123456789", "대법원 202두123", "대법원 1000억원2024"])(
    "does not accept malformed case identifiers: %s",
    (citation) => {
      // Given / When
      const parsed = parseCitation(citation)
      // Then
      expect(parsed.kind).toBe("unknown")
    },
  )

  it.each([
    ["2024두12345, 2024두12346", "VERIFIED"],
    ["2024두123456", "UNVERIFIED"],
    ["", "UNVERIFIED"],
  ])(
    "verifies exact members of joined case fields without prefix matches: %s",
    async (field, status) => {
      // Given
      const api = await startFakeLawApi((_request, response) => {
        response.setHeader("content-type", "application/json")
        response.end(
          JSON.stringify({
            PrecSearch: {
              totalCnt: field === "" ? "0" : "1",
              ...(field === ""
                ? {}
                : {
                    prec: [
                      {
                        판례일련번호: "1",
                        사건명: "입찰참가자격제한처분취소",
                        사건번호: field,
                        법원명: "대법원",
                        선고일자: "20241001",
                      },
                    ],
                  }),
            },
          }),
        )
      })
      apis.push(api)
      const verifier = new CitationVerifier(
        new LawProvider({ apiKey: "test", baseUrl: api.baseUrl }),
      )
      // When
      const result = await verifier.verify(["대법원 2024두12345"])
      // Then
      expect(result[0]?.status).toBe(status)
      if (status === "VERIFIED") expect(result[0]?.verificationScope).toBe("case_identity")
    },
  )
})
