import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { DapaSearchResult, LegalDocumentDetail, ResponseStatus } from "../../types/results.js"
import type { LawProvider, LegalDetailInput, LegalSearchInput } from "./law-provider.js"

const MAX_QUERY_VARIANTS = 3
const MAX_SEARCH_PAGES = 2
const MAX_CANDIDATES = 30

export type LegalContentHit = {
  readonly document: DapaSearchResult
  readonly status: ResponseStatus
  readonly match: "content" | "metadata"
  readonly detail?: LegalDocumentDetail
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export type LegalContentSearchResponse = {
  readonly status: ResponseStatus
  readonly results: readonly LegalContentHit[]
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export async function searchLegalContent(
  law: Pick<LawProvider, "search" | "getDetail">,
  input: LegalSearchInput,
): Promise<LegalContentSearchResponse> {
  const candidates = new Map<string, DapaSearchResult>()
  const searchErrors: { code: string; message: string }[] = []
  const searchRequests = expandSearchQueries(input.query)
    .slice(0, MAX_QUERY_VARIANTS)
    .flatMap((query) =>
      Array.from({ length: MAX_SEARCH_PAGES }, (_, index) =>
        law.search({
          ...input,
          query,
          page: index + 1,
          limit: Math.min(Math.max(input.limit ?? 10, 10), MAX_CANDIDATES),
        }),
      ),
    )
  const searches = await Promise.all(searchRequests)
  for (const search of searches) {
    searchErrors.push(...search.errors)
    for (const document of search.results) {
      candidates.set(`${document.sourceType}:${document.documentId}`, document)
    }
  }
  if (candidates.size === 0) {
    return {
      status: searchErrors.length > 0 ? "SOURCE_UNAVAILABLE" : "NOT_FOUND",
      results: [],
      errors: searchErrors,
    }
  }

  const outcomes = await Promise.all(
    [...candidates.values()].slice(0, MAX_CANDIDATES).map(async (document) => {
      const detailInput: LegalDetailInput = {
        documentId: document.documentId,
        sourceType: document.sourceType,
      }
      const detail = await law.getDetail(detailInput)
      return {
        document,
        status: detail.status,
        match:
          detail.status === "OK" &&
          detail.detail !== undefined &&
          bodyContainsQuery(detail.detail, input.query)
            ? "content"
            : "metadata",
        ...(detail.detail === undefined ? {} : { detail: detail.detail }),
        errors: detail.errors,
      } satisfies LegalContentHit
    }),
  )
  const detailErrors = outcomes.flatMap((outcome) => outcome.errors)
  const combinedErrors = [...searchErrors, ...detailErrors]
  const successful = outcomes.filter((outcome) => outcome.status === "OK")
  const bodyMatches = outcomes.filter((outcome) => outcome.match === "content")
  const ordered =
    bodyMatches.length > 0
      ? [...bodyMatches, ...outcomes.filter((outcome) => outcome.match !== "content")]
      : outcomes
  return {
    status:
      successful.length === 0
        ? "SOURCE_UNAVAILABLE"
        : combinedErrors.length > 0
          ? "PARTIAL_RESULT"
          : "OK",
    results: ordered,
    errors: combinedErrors,
  }
}

function expandSearchQueries(query: string): readonly string[] {
  const collapsed = query.replace(/\s+/gu, " ").trim()
  const compact = collapsed.replace(/\s+/gu, "")
  return [...new Set([query, collapsed, compact])].filter((value) => value.length > 0)
}

function bodyContainsQuery(detail: LegalDocumentDetail, query: string): boolean {
  const body = normalizeSearchText(JSON.stringify(detail))
  const normalizedQuery = normalizeSearchText(query)
  if (normalizedQuery.length > 0 && body.includes(normalizedQuery)) return true
  const tokens = query
    .split(/[^0-9A-Za-z가-힣]+/u)
    .map(normalizeSearchText)
    .filter((token) => token.length >= 2)
  return tokens.length > 0 && tokens.every((token) => body.includes(token))
}
