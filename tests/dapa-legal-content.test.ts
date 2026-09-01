import { describe, expect, it } from "vitest"
import {
  getDapaLegalContent,
  type LegalContentSource,
} from "../src/providers/dapa-catalog/content.js"
import type { DapaCatalogProvider } from "../src/providers/dapa-catalog/provider.js"
import type { DapaCatalogItem } from "../src/providers/dapa-catalog/schemas.js"

const catalogItem: DapaCatalogItem = {
  id: "admin-rule:625652",
  kind: "admin_rule",
  category: "훈령",
  title: "방위사업관리규정",
  listNumber: 2622,
  dapaRegistrationId: "625652",
  promulgationNumber: "981",
  promulgationDate: "2026-08-11",
  sourceUrl: "https://www.dapa.go.kr/dapa/rlm/rllawd/RlmNttList.do?menuSeq=3088",
  retrievedAt: "2026-08-27T02:33:38.017Z",
}

describe("DAPA legal content binding", () => {
  it("resolves a DAPA rule to the matching law.go.kr document before retrieving detail", async () => {
    // Given
    const catalog = fakeCatalog(catalogItem)
    const law: LegalContentSource = {
      search: async () => ({
        status: "OK",
        results: [
          {
            id: "law-rule-981",
            source: "국가법령정보 공동활용 Open API",
            sourceType: "administrative_rule",
            title: "방위사업관리규정",
            summary: "981",
            date: "2026-08-11",
            status: "unknown",
            verified: true,
            retrievedAt: "2026-08-27T02:33:38.017Z",
            documentId: "law-rule-981",
          },
        ],
        errors: [],
      }),
      getDetail: async (input) => ({
        status: "OK",
        results: [],
        detail: {
          basicInfo: { title: input.documentId },
          articles: [{ articleNumber: "1", text: "본문" }],
          supplementaryProvisions: [],
          annexes: [],
          forms: [],
        },
        errors: [],
      }),
    }

    // When
    const response = await getDapaLegalContent(catalog, law, catalogItem.id)

    // Then
    expect(response.status).toBe("OK")
    expect(response.matchedDocument?.documentId).toBe("law-rule-981")
    expect(response.legal?.detail?.articles[0]?.text).toBe("본문")
  })

  it("resolves a DAPA display-title variant to the API canonical document", async () => {
    // Given
    const variant: DapaCatalogItem = {
      ...catalogItem,
      id: "admin-rule:1047",
      title: "절충교역 지침(국문,영문)",
      listNumber: 1,
      dapaRegistrationId: "1047",
      promulgationNumber: "1047",
      promulgationDate: "2026-02-10",
    }
    const catalog = fakeCatalog(variant)
    const law: LegalContentSource = {
      search: async ({ query }) =>
        query === variant.title
          ? { status: "NOT_FOUND", results: [], errors: [] }
          : {
              status: "OK",
              results: [
                {
                  id: "rule-1047",
                  source: "국가법령정보 공동활용 Open API",
                  sourceType: "administrative_rule",
                  title: "절충교역 지침",
                  summary: "1047",
                  date: "2026-02-10",
                  status: "current",
                  verified: true,
                  retrievedAt: "2026-08-27T02:33:38.017Z",
                  documentId: "rule-1047",
                },
              ],
              errors: [],
            },
      getDetail: async (input) => ({
        status: "OK",
        results: [],
        detail: {
          basicInfo: { title: input.documentId },
          articles: [{ articleNumber: "1", text: "정식 본문" }],
          supplementaryProvisions: [],
          annexes: [],
          forms: [],
        },
        errors: [],
      }),
    }

    // When
    const response = await getDapaLegalContent(catalog, law, variant.id)

    // Then
    expect(response.status).toBe("OK")
    expect(response.matchedDocument?.documentId).toBe("rule-1047")
    expect(response.legal?.detail?.articles[0]?.text).toBe("정식 본문")
  })

  it("retrieves every ambiguous API candidate body instead of stopping at the first match", async () => {
    // Given
    const catalog = fakeCatalog(catalogItem)
    const law: LegalContentSource = {
      search: async () => ({
        status: "OK",
        results: [
          {
            id: "rule-a",
            source: "api",
            sourceType: "administrative_rule",
            title: catalogItem.title,
            summary: "981",
            date: catalogItem.promulgationDate,
            status: "current",
            verified: true,
            retrievedAt: "2026-08-27T02:33:38.017Z",
            documentId: "rule-a",
          },
          {
            id: "rule-b",
            source: "api",
            sourceType: "administrative_rule",
            title: catalogItem.title,
            summary: "981",
            date: catalogItem.promulgationDate,
            status: "current",
            verified: true,
            retrievedAt: "2026-08-27T02:33:38.017Z",
            documentId: "rule-b",
          },
        ],
        errors: [],
      }),
      getDetail: async (input) => ({
        status: "OK",
        results: [],
        detail: {
          basicInfo: { title: input.documentId },
          articles: [{ articleNumber: "1", text: input.documentId }],
          supplementaryProvisions: [],
          annexes: [],
          forms: [],
        },
        errors: [],
      }),
    }

    // When
    const response = await getDapaLegalContent(catalog, law, catalogItem.id)

    // Then
    expect(response.status).toBe("OK")
    expect(response.matches?.map((match) => match.matchedDocument.documentId)).toEqual([
      "rule-a",
      "rule-b",
    ])
    expect(response.matches?.map((match) => match.legal.detail?.articles[0]?.text)).toEqual([
      "rule-a",
      "rule-b",
    ])
  })
})

function fakeCatalog(item: DapaCatalogItem): DapaCatalogProvider {
  return {
    search: () => ({ status: "OK", results: [item], errors: [] }),
    get: (id) => (id === item.id ? item : undefined),
    status: () => ({
      state: "healthy",
      totalCount: 1,
      lawCount: 0,
      adminRuleCount: 1,
      pageCount: 1,
    }),
  }
}
