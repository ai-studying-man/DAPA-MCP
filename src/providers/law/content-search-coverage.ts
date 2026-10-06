import type { SearchPageCoverage, SearchResponse } from "../../types/results.js"
import type { LegalContentHit } from "./content-search.js"

export type ContentSearchCoverage = {
  readonly discoveryScope: "major_documents" | "expanded"
  readonly candidateDocuments: number
  readonly inspectedDocuments: number
  readonly attemptedDocuments: number
  readonly unavailableDocuments: number
  readonly remainingCandidates: number
  readonly returnedDocuments: number
  readonly omittedResults: number
  readonly discoveryResultLimitReached: boolean
  readonly pages: readonly SearchPageCoverage[]
  readonly hasMorePages: boolean
  readonly paginationKnown: boolean
  readonly omittedQueryVariants: number
  readonly truncatedEvidence: boolean
  readonly exhaustive: false
  readonly nextAction:
    | "retry_sources"
    | "expand_search"
    | "inspect_remaining"
    | "get_full_detail"
    | "none"
}

export type ContentCoverageInput = {
  readonly searches: readonly SearchResponse[]
  readonly candidateDocuments: number
  readonly outcomes: readonly LegalContentHit[]
  readonly returnedDocuments: number
  readonly majorDocumentsOnly: boolean
  readonly omittedQueryVariants: number
}

export function contentSearchCoverage(input: ContentCoverageInput): ContentSearchCoverage {
  const pages = input.searches.flatMap((search) => search.coverage?.pages ?? [])
  const latestPages = new Map<string, SearchPageCoverage>()
  for (const page of pages) {
    const key = JSON.stringify([page.sourceType, page.query ?? ""])
    const prior = latestPages.get(key)
    if (prior === undefined || page.page > prior.page) latestPages.set(key, page)
  }
  const inspectedDocuments = input.outcomes.filter((hit) => hit.status === "OK").length
  const unavailableDocuments = input.outcomes.length - inspectedDocuments
  const remainingCandidates = Math.max(0, input.candidateDocuments - inspectedDocuments)
  const truncatedEvidence = input.outcomes.some((hit) => hit.evidenceCoverage?.truncated === true)
  const hasMorePages = [...latestPages.values()].some((page) => page.hasMore)
  const paginationKnown =
    input.searches.length > 0 && input.searches.every((search) => search.coverage !== undefined)
  const omittedResults = Math.max(0, input.outcomes.length - input.returnedDocuments)
  const discoveryResultLimitReached = input.searches.some(
    (search) => search.coverage?.resultLimitReached === true,
  )
  return {
    discoveryScope: input.majorDocumentsOnly ? "major_documents" : "expanded",
    candidateDocuments: input.candidateDocuments,
    inspectedDocuments,
    attemptedDocuments: input.outcomes.length,
    unavailableDocuments,
    remainingCandidates,
    returnedDocuments: input.returnedDocuments,
    omittedResults,
    discoveryResultLimitReached,
    pages,
    hasMorePages,
    paginationKnown,
    omittedQueryVariants: input.omittedQueryVariants,
    truncatedEvidence,
    exhaustive: false,
    nextAction:
      unavailableDocuments > 0 || input.searches.some((search) => search.errors.length > 0)
        ? "retry_sources"
        : discoveryResultLimitReached ||
            input.majorDocumentsOnly ||
            hasMorePages ||
            !paginationKnown ||
            input.omittedQueryVariants > 0
          ? "expand_search"
          : remainingCandidates > 0 || omittedResults > 0
            ? "inspect_remaining"
            : truncatedEvidence
              ? "get_full_detail"
              : "none",
  }
}
