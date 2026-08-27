import { describe, expect, it } from "vitest"
import { auditDapaCatalogCoverage } from "../src/providers/dapa-catalog/audit.js"
import type { LegalContentSource } from "../src/providers/dapa-catalog/content.js"
import type { DapaCatalogFile } from "../src/providers/dapa-catalog/schemas.js"

const catalog: DapaCatalogFile = {
  schemaVersion: 1,
  generatedAt: "2026-08-27T02:33:38.017Z",
  lawSourceUrl: "https://www.dapa.go.kr/dapa/page/selectPage.do?menuSeq=3087&pageSeq=3246",
  adminRuleSourceUrl: "https://www.dapa.go.kr/dapa/rlm/rllawd/RlmNttList.do?menuSeq=3088",
  pageCount: 1,
  items: [
    {
      id: "admin-rule:1",
      kind: "admin_rule",
      category: "훈령",
      title: "존재하는 규정",
      listNumber: 1,
      dapaRegistrationId: "1",
      promulgationNumber: "1",
      promulgationDate: "2026-01-01",
      sourceUrl: "https://www.dapa.go.kr/rule?page=1",
      retrievedAt: "2026-08-27T02:33:38.017Z",
    },
    {
      id: "admin-rule:2",
      kind: "admin_rule",
      category: "예규",
      title: "없는 규정",
      listNumber: 2,
      dapaRegistrationId: "2",
      promulgationNumber: "2",
      promulgationDate: "2026-01-02",
      sourceUrl: "https://www.dapa.go.kr/rule?page=1",
      retrievedAt: "2026-08-27T02:33:38.017Z",
    },
    {
      id: "admin-rule:3",
      kind: "admin_rule",
      category: "예규",
      title: "표시용 규정(국문,영문)",
      listNumber: 3,
      dapaRegistrationId: "3",
      promulgationNumber: "3",
      promulgationDate: "2026-01-03",
      sourceUrl: "https://www.dapa.go.kr/rule?page=1",
      retrievedAt: "2026-08-27T02:33:38.017Z",
    },
  ],
}

describe("DAPA catalog coverage audit", () => {
  it("reports catalog items with no exact national-law match", async () => {
    // Given
    const law: LegalContentSource = {
      search: async ({ query }) =>
        query === "존재하는 규정"
          ? {
              status: "OK",
              results: [
                {
                  id: "law-1",
                  source: "국가법령정보 공동활용 Open API",
                  sourceType: "administrative_rule",
                  title: "존재하는 규정",
                  summary: "1",
                  date: "2026-01-01",
                  status: "unknown",
                  verified: true,
                  retrievedAt: "2026-08-27T02:33:38.017Z",
                  documentId: "law-1",
                },
              ],
              errors: [],
            }
          : query === "표시용 규정(국문,영문)"
            ? {
                status: "OK",
                results: [
                  {
                    id: "law-3",
                    source: "국가법령정보 공동활용 Open API",
                    sourceType: "administrative_rule",
                    title: "표시용 규정",
                    summary: "3",
                    date: "2026-01-03",
                    status: "current",
                    verified: true,
                    retrievedAt: "2026-08-27T02:33:38.017Z",
                    documentId: "law-3",
                  },
                ],
                errors: [],
              }
            : { status: "NOT_FOUND", results: [], errors: [] },
      getDetail: async () => ({ status: "NOT_FOUND", results: [], errors: [] }),
    }

    // When
    const report = await auditDapaCatalogCoverage(catalog, law, { concurrency: 2 })

    // Then
    expect(report.totals).toMatchObject({
      total: 3,
      matched: 1,
      titleVariant: 1,
      missing: 1,
    })
    expect(report.missing[0]).toMatchObject({
      id: "admin-rule:2",
      title: "없는 규정",
      category: "예규",
      listNumber: 2,
      promulgationNumber: "2",
      promulgationDate: "2026-01-02",
      sourceUrl: "https://www.dapa.go.kr/rule?page=1",
    })
    expect(report.items[2]).toMatchObject({
      id: "admin-rule:3",
      status: "title_variant",
      matchedDocumentIds: ["law-3"],
    })
  })
})
