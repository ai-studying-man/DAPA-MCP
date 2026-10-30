import { normalizeSearchText } from "../../lib/normalization/text.js"
import { planCaseSearch } from "./case-search-plan.js"
import type {
  LegalContentHit,
  LegalContentSearchInput,
  LegalContentSearchResponse,
} from "./content-search.js"
import { contentSearchCoverage } from "./content-search-coverage.js"
import { hydrateDocuments } from "./content-search-hydration.js"
import { rankCandidates } from "./content-search-plan.js"
import type { LawProvider } from "./law-provider.js"

type Provider = Pick<LawProvider, "search" | "getDetail">

export type CaseContentHit = LegalContentHit & {
  readonly caseRelevance?: "direct_defense" | "general_supplement" | "unverified"
}

export async function searchCases(
  law: Provider,
  input: LegalContentSearchInput,
): Promise<LegalContentSearchResponse> {
  const plan = planCaseSearch(input.query)
  const thorough = input.mode === "thorough"
  const { organization: _organization, asOfDate: _asOfDate, ...caseInput } = input
  const queries = plan.searchQueries.slice(0, thorough ? 3 : 2)
  const requests = [
    ...queries.map((query) => ({ query, searchScope: "title" as const, focused: false })),
    ...(thorough
      ? [queries[0]]
          .filter((query): query is string => query !== undefined)
          .flatMap((query) => [
            { query: `${query} 방위사업청`, searchScope: "content" as const, focused: true },
            { query: `${query} 군수품`, searchScope: "content" as const, focused: true },
            { query, searchScope: "content" as const, focused: false },
          ])
      : []),
  ]
  const searches = await Promise.all(
    requests.map(({ query, searchScope }) =>
      law.search({
        ...caseInput,
        query,
        types: ["precedent"],
        currentOnly: false,
        searchScope,
        page: input.page ?? 1,
        limit: thorough ? 30 : 20,
      }),
    ),
  )
  const unique = new Map(
    searches.flatMap((search) => search.results).map((document) => [document.documentId, document]),
  )
  const quota = thorough ? (plan.intent === "case_request" ? 5 : 3) : 2
  const focusedIds = new Set(
    searches.flatMap((search, index) =>
      requests[index]?.focused === true
        ? search.results.map((document) => document.documentId)
        : [],
    ),
  )
  const documents = rankCandidates([...unique.values()], plan.evidenceQueries)
    .map((document, index) => ({
      document,
      index,
      focused: Number(focusedIds.has(document.documentId)),
      issues: plan.searchQueries.reduce(
        (count, query) =>
          count + Number(normalizeSearchText(document.title).includes(normalizeSearchText(query))),
        0,
      ),
    }))
    .sort(
      (left, right) =>
        right.focused - left.focused ||
        right.issues - left.issues ||
        (right.document.date ?? "").localeCompare(left.document.date ?? "") ||
        left.index - right.index,
    )
    .map(({ document }) => document)
    .slice(0, Math.min(quota, Math.max(input.limit ?? quota, 1)))
  const defenseBodies = new Set<string>()
  const caseProvider: Pick<LawProvider, "getDetail"> = {
    getDetail: async (request) => {
      const response = await law.getDetail(request)
      if (
        response.status === "OK" &&
        /(?:방위사업청|방산물자|군수품|국방규격)/u.test(
          JSON.stringify({ detail: response.detail, content: response.results[0]?.content }),
        )
      )
        defenseBodies.add(request.documentId)
      return response
    },
  }
  const outcomes = await hydrateDocuments({
    law: caseProvider,
    documents,
    queries: plan.evidenceQueries,
    forceRefresh: input.forceRefresh === true,
    concurrency: thorough ? 3 : 2,
    deadlineAt: input.deadlineAt ?? Date.now() + 25_000,
    currentOnly: false,
  })
  const relevancePriority = { direct_defense: 2, general_supplement: 1, unverified: 0 } as const
  const results: CaseContentHit[] = outcomes
    .map(
      (hit) =>
        ({
          ...hit,
          caseRelevance:
            hit.match !== "content"
              ? "unverified"
              : defenseBodies.has(hit.document.documentId)
                ? "direct_defense"
                : "general_supplement",
        }) satisfies CaseContentHit,
    )
    .sort(
      (left, right) =>
        relevancePriority[right.caseRelevance] - relevancePriority[left.caseRelevance],
    )
  const errors = [
    ...searches.flatMap((search) => search.errors),
    ...outcomes.flatMap((hit) => hit.errors),
  ]
  return {
    status:
      errors.length > 0
        ? outcomes.some((hit) => hit.status === "OK")
          ? "PARTIAL_RESULT"
          : "SOURCE_UNAVAILABLE"
        : outcomes.length === 0
          ? "NOT_FOUND"
          : "OK",
    results,
    errors,
    coverage: contentSearchCoverage({
      searches,
      candidateDocuments: unique.size,
      outcomes,
      returnedDocuments: results.length,
      majorDocumentsOnly: false,
      omittedQueryVariants: Math.max(0, plan.searchQueries.length - queries.length),
    }),
  }
}
