import type { DapaSearchResult } from "../../types/results.js"
import type { LegalContentHit } from "./content-search.js"
import {
  extractExcerptEvidence,
  matchingDetailCoverage,
  selectMatchingDetail,
} from "./content-search-evidence.js"
import { koreaToday } from "./law-api-temporal.js"
import type { LawProvider, LegalDetailInput } from "./law-provider.js"

type HydrationRequest = {
  readonly law: Pick<LawProvider, "getDetail">
  readonly documents: readonly DapaSearchResult[]
  readonly queries: readonly string[]
  readonly forceRefresh: boolean
  readonly concurrency: number
  readonly deadlineAt: number
  readonly currentOnly: boolean
  readonly asOfDate?: string
}

export async function hydrateDocuments(
  request: HydrationRequest,
): Promise<readonly LegalContentHit[]> {
  const outcomes: LegalContentHit[] = []
  let nextIndex = 0
  await Promise.all(
    Array.from({ length: Math.min(request.concurrency, request.documents.length) }, async () => {
      while (nextIndex < request.documents.length) {
        const index = nextIndex++
        const document = request.documents[index]
        if (document === undefined) return
        const detailInput: LegalDetailInput = {
          documentId: document.documentId,
          sourceType: document.sourceType,
          forceRefresh: request.forceRefresh,
          deadlineAt: request.deadlineAt,
          currentOnly: request.currentOnly,
          ...(request.asOfDate === undefined ? {} : { asOfDate: request.asOfDate }),
        }
        const detail = await request.law.getDetail(detailInput)
        const { content: rawContent, ...resolvedDocument } = detail.results[0] ?? document
        const evidenceDate = request.asOfDate ?? (request.currentOnly ? koreaToday() : undefined)
        const matchingDetail =
          detail.detail === undefined
            ? undefined
            : selectMatchingDetail(detail.detail, request.queries, evidenceDate)
        const excerptEvidence =
          matchingDetail === undefined
            ? extractExcerptEvidence(rawContent, request.queries, evidenceDate)
            : undefined
        const excerpts = excerptEvidence?.excerpts ?? []
        const evidenceCoverage =
          matchingDetail !== undefined && detail.detail !== undefined
            ? matchingDetailCoverage(detail.detail, request.queries, evidenceDate)
            : excerptEvidence?.coverage
        const hasEvidence = matchingDetail !== undefined || excerpts.length > 0
        outcomes[index] = {
          document: detail.status === "OK" ? { ...document, ...resolvedDocument } : document,
          status: detail.status,
          match: detail.status === "OK" && hasEvidence ? "content" : "metadata",
          ...(matchingDetail === undefined ? {} : { detail: matchingDetail }),
          ...(excerpts.length === 0 ? {} : { excerpts }),
          ...(evidenceCoverage === undefined ? {} : { evidenceCoverage }),
          errors: detail.errors,
        } satisfies LegalContentHit
      }
    }),
  )
  return outcomes
}
