import type { DapaSearchResult, LegalDocumentDetail, ResponseStatus } from "../../types/results.js"
import {
  extractMatchingExcerpts,
  firstMatchingQueryIndex,
  selectMatchingDetail,
} from "./content-search-evidence.js"
import {
  inferLegalSourceTypes,
  isDocumentTitleQuery,
  planContentSearch,
  rankCandidates,
  SEARCH_PROFILES,
  titleRelevanceScore,
} from "./content-search-plan.js"
import type { LawProvider, LegalDetailInput, LegalSearchInput } from "./law-provider.js"

export type { LegalContentSearchMode } from "./content-search-plan.js"
export { LEGAL_CONTENT_SEARCH_MODES } from "./content-search-plan.js"

import type { LegalContentSearchMode } from "./content-search-plan.js"

export type LegalContentSearchInput = LegalSearchInput & {
  readonly mode?: LegalContentSearchMode
  readonly timeBudgetMs?: number
}

export type LegalContentHit = {
  readonly document: DapaSearchResult
  readonly status: ResponseStatus
  readonly match: "content" | "metadata"
  readonly detail?: LegalDocumentDetail
  readonly excerpts?: readonly string[]
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export type LegalContentSearchResponse = {
  readonly status: ResponseStatus
  readonly results: readonly LegalContentHit[]
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

type SearchState = {
  readonly candidates: ReadonlyMap<string, DapaSearchResult>
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

type HydrationRequest = {
  readonly law: Pick<LawProvider, "getDetail">
  readonly documents: readonly DapaSearchResult[]
  readonly queries: readonly string[]
  readonly forceRefresh: boolean
  readonly concurrency: number
  readonly deadlineAt: number
}

export async function searchLegalContent(
  law: Pick<LawProvider, "search" | "getDetail">,
  input: LegalContentSearchInput,
): Promise<LegalContentSearchResponse> {
  const mode = input.mode ?? "fast"
  const profile = SEARCH_PROFILES[mode]
  const limit = Math.min(Math.max(input.limit ?? 5, 1), profile.maxDocuments)
  const queryPlan = planContentSearch(input.query)
  const queries = queryPlan.searchQueries.slice(0, profile.queryVariants)
  const searchInput = {
    ...input,
    types: input.types ?? inferLegalSourceTypes(input.query),
    deadlineAt: input.deadlineAt ?? Date.now() + (input.timeBudgetMs ?? 25_000),
  } satisfies LegalSearchInput
  let state = await searchPages(law, searchInput, queries, 1, profile.searchPages)
  if (state.candidates.size === 0) return emptyResponse(state.errors)

  const rankedCandidates = rankCandidates([...state.candidates.values()], queries)
  const initialCount = Math.min(limit, profile.initialDocuments)
  let outcomes = await hydrateDocuments({
    law,
    documents: rankedCandidates.slice(0, initialCount),
    queries: queryPlan.evidenceQueries,
    forceRefresh: input.forceRefresh === true,
    concurrency: profile.detailConcurrency,
    deadlineAt: searchInput.deadlineAt,
  })

  if (mode === "fast" && !hasContentMatch(outcomes) && outcomes.length < limit) {
    if (state.candidates.size < limit) {
      state = mergeSearchStates(state, await searchPages(law, searchInput, queries, 2, 1))
    }
    const hydratedKeys = new Set(
      outcomes.map(({ document }) => `${document.sourceType}:${document.documentId}`),
    )
    const remaining = rankCandidates([...state.candidates.values()], queries)
      .filter((document) => !hydratedKeys.has(`${document.sourceType}:${document.documentId}`))
      .slice(0, limit - outcomes.length)
    outcomes = [
      ...outcomes,
      ...(await hydrateDocuments({
        law,
        documents: remaining,
        queries: queryPlan.evidenceQueries,
        forceRefresh: input.forceRefresh === true,
        concurrency: profile.detailConcurrency,
        deadlineAt: searchInput.deadlineAt,
      })),
    ]
  }

  return completedResponse(outcomes, state.errors, queryPlan.evidenceQueries)
}

async function searchPages(
  law: Pick<LawProvider, "search">,
  input: LegalSearchInput,
  queries: readonly string[],
  firstPage: number,
  pageCount: number,
): Promise<SearchState> {
  const requestLimit = 100
  const searches = await Promise.all(
    queries.flatMap((query) =>
      Array.from({ length: pageCount }, (_, index) =>
        law.search({
          ...input,
          query,
          page: firstPage + index,
          limit: requestLimit,
          searchScope: isDocumentTitleQuery(query) ? "title" : "content",
        }),
      ),
    ),
  )
  return mergeSearchResults(searches)
}

function mergeSearchResults(
  searches: readonly Awaited<ReturnType<LawProvider["search"]>>[],
): SearchState {
  const candidates = new Map<string, DapaSearchResult>()
  const errors: { code: string; message: string }[] = []
  for (const search of searches) {
    errors.push(...search.errors)
    for (const document of search.results) {
      candidates.set(`${document.sourceType}:${document.documentId}`, document)
    }
  }
  return { candidates, errors }
}

function mergeSearchStates(left: SearchState, right: SearchState): SearchState {
  const candidates = new Map(left.candidates)
  for (const [key, document] of right.candidates) candidates.set(key, document)
  return { candidates, errors: [...left.errors, ...right.errors] }
}

async function hydrateDocuments(request: HydrationRequest): Promise<readonly LegalContentHit[]> {
  const outcomes: LegalContentHit[] = []
  for (let offset = 0; offset < request.documents.length; offset += request.concurrency) {
    const batch = request.documents.slice(offset, offset + request.concurrency)
    outcomes.push(
      ...(await Promise.all(
        batch.map(async (document) => {
          const detailInput: LegalDetailInput = {
            documentId: document.documentId,
            sourceType: document.sourceType,
            forceRefresh: request.forceRefresh,
            deadlineAt: request.deadlineAt,
          }
          const detail = await request.law.getDetail(detailInput)
          const matchingDetail =
            detail.detail === undefined
              ? undefined
              : selectMatchingDetail(detail.detail, request.queries)
          const excerpts =
            matchingDetail === undefined
              ? extractMatchingExcerpts(detail.results[0]?.content, request.queries)
              : []
          const hasEvidence = matchingDetail !== undefined || excerpts.length > 0
          return {
            document,
            status: detail.status,
            match: detail.status === "OK" && hasEvidence ? "content" : "metadata",
            ...(matchingDetail === undefined ? {} : { detail: matchingDetail }),
            ...(excerpts.length === 0 ? {} : { excerpts }),
            errors: detail.errors,
          } satisfies LegalContentHit
        }),
      )),
    )
  }
  return outcomes
}

function completedResponse(
  outcomes: readonly LegalContentHit[],
  searchErrors: readonly { readonly code: string; readonly message: string }[],
  evidenceQueries: readonly string[],
): LegalContentSearchResponse {
  const errors = [...searchErrors, ...outcomes.flatMap((outcome) => outcome.errors)]
  const successful = outcomes.filter((outcome) => outcome.status === "OK")
  const bodyMatches = outcomes
    .map((outcome, index) => ({ outcome, index }))
    .filter(({ outcome }) => outcome.match === "content")
    .sort(
      (left, right) =>
        contentEvidenceScore(right.outcome, evidenceQueries) -
          contentEvidenceScore(left.outcome, evidenceQueries) || left.index - right.index,
    )
    .map(({ outcome }) => outcome)
  const ordered =
    bodyMatches.length > 0
      ? [...bodyMatches, ...outcomes.filter((outcome) => outcome.match !== "content")]
      : outcomes
  return {
    status:
      successful.length === 0 ? "SOURCE_UNAVAILABLE" : errors.length > 0 ? "PARTIAL_RESULT" : "OK",
    results: ordered,
    errors,
  }
}

function contentEvidenceScore(
  outcome: LegalContentHit,
  evidenceQueries: readonly string[],
): number {
  const detail = outcome.detail
  const excerptCount = outcome.excerpts?.length ?? 0
  const sectionCount =
    detail === undefined
      ? excerptCount
      : detail.articles.length +
        detail.supplementaryProvisions.length +
        detail.annexes.length +
        detail.forms.length +
        (detail.amendmentText === undefined ? 0 : 1) +
        (detail.amendmentReason === undefined ? 0 : 1) +
        excerptCount
  const evidence = JSON.stringify({ detail, excerpts: outcome.excerpts })
  const queryIndex = firstMatchingQueryIndex(evidence, evidenceQueries)
  const priority = queryIndex < 0 ? 0 : (evidenceQueries.length - queryIndex) * 1_000
  return priority + titleRelevanceScore(outcome.document.title, evidenceQueries) * 5 + sectionCount
}

function emptyResponse(
  errors: readonly { readonly code: string; readonly message: string }[],
): LegalContentSearchResponse {
  return { status: errors.length > 0 ? "SOURCE_UNAVAILABLE" : "NOT_FOUND", results: [], errors }
}

function hasContentMatch(outcomes: readonly LegalContentHit[]): boolean {
  return outcomes.some((outcome) => outcome.match === "content")
}
