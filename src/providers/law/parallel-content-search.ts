import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { ResponseStatus, SourceType } from "../../types/results.js"
import { planCaseSearch } from "./case-search-plan.js"
import {
  type LegalContentHit,
  type LegalContentSearchInput,
  type LegalContentSearchResponse,
  searchLegalContent,
} from "./content-search.js"
import { type ContentSearchCoverage, contentSearchCoverage } from "./content-search-coverage.js"
import { hydrateDocuments } from "./content-search-hydration.js"
import { inferLegalSourceTypes, rankCandidates } from "./content-search-plan.js"
import type { LawProvider } from "./law-provider.js"
import { toErrorShape } from "./law-provider-response.js"

type SearchError = { readonly code: string; readonly message: string }
export type ContentSearchLane = {
  readonly name: "legal" | "cases"
  readonly status: ResponseStatus
  readonly sourceTypes: readonly SourceType[]
  readonly searched: boolean
  readonly reason?: "insufficient_query"
  readonly errors: readonly SearchError[]
  readonly coverage?: ContentSearchCoverage
}
export type CaseContentHit = LegalContentHit & {
  readonly caseRelevance?: "direct_defense" | "general_supplement" | "unverified"
}
export type ParallelContentSearchResponse = Omit<LegalContentSearchResponse, "results"> & {
  readonly results: readonly CaseContentHit[]
  readonly lanes: readonly ContentSearchLane[]
}
type Provider = Pick<LawProvider, "search" | "getDetail">

export async function searchLegalContentParallel(
  law: Provider,
  input: LegalContentSearchInput,
): Promise<ParallelContentSearchResponse> {
  const deadlineAt = input.deadlineAt ?? Date.now() + (input.timeBudgetMs ?? 25_000)
  const inferred = inferLegalSourceTypes(input.query)
  const types = input.types ?? [
    ...new Set<SourceType>(["law", "administrative_rule", ...inferred, "precedent"]),
  ]
  const legalTypes = types.filter((type) => type !== "precedent")
  const caseTypes = types.filter((type) => type === "precedent")
  const request = { ...input, deadlineAt }
  const [legal, cases] = await Promise.all([
    runLane(() =>
      legalTypes.length === 0
        ? Promise.resolve(empty())
        : searchLegalContent(law, {
            ...request,
            query: input.types === undefined ? planCaseSearch(input.query).legalQuery : input.query,
            types: legalTypes,
          }),
    ),
    runLane(() => (caseTypes.length === 0 ? Promise.resolve(empty()) : searchCases(law, request))),
  ])
  const active = [
    legalTypes.length > 0 ? legal : undefined,
    caseTypes.length > 0 ? cases : undefined,
  ].filter((lane) => lane !== undefined)
  const errors = active.flatMap((lane) => lane.errors)
  const results = [...legal.results, ...cases.results]
  const failed = active.some(
    (lane) => lane.status === "SOURCE_UNAVAILABLE" || lane.status === "PARTIAL_RESULT",
  )
  return {
    status:
      active.length > 0 && active.every((lane) => lane.status === "SOURCE_UNAVAILABLE")
        ? "SOURCE_UNAVAILABLE"
        : failed
          ? "PARTIAL_RESULT"
          : results.length === 0
            ? "NOT_FOUND"
            : "OK",
    results,
    errors,
    ...(legal.coverage === undefined ? {} : { coverage: legal.coverage }),
    lanes: [
      laneSummary("legal", legalTypes, legal),
      {
        ...laneSummary("cases", caseTypes, cases),
        ...(caseTypes.length > 0 && planCaseSearch(input.query).searchQueries.length === 0
          ? { searched: false, reason: "insufficient_query" as const }
          : {}),
      },
    ],
  }
}

async function runLane(
  run: () => Promise<LegalContentSearchResponse>,
): Promise<LegalContentSearchResponse> {
  try {
    return await run()
  } catch (error) {
    if (!(error instanceof Error)) throw error
    return { status: "SOURCE_UNAVAILABLE", results: [], errors: [toErrorShape(error)] }
  }
}

async function searchCases(
  law: Provider,
  input: LegalContentSearchInput,
): Promise<LegalContentSearchResponse> {
  const plan = planCaseSearch(input.query)
  const thorough = input.mode === "thorough"
  const { organization: _organization, asOfDate: _asOfDate, ...caseInput } = input
  const queries = plan.searchQueries.slice(0, thorough ? 3 : 2)
  const searches = await Promise.all(
    queries.map((query) =>
      law.search({
        ...caseInput,
        query,
        types: ["precedent"],
        currentOnly: false,
        searchScope: "title",
        page: input.page ?? 1,
        limit: thorough ? 30 : 20,
      }),
    ),
  )
  const unique = new Map(
    searches.flatMap((search) => search.results).map((document) => [document.documentId, document]),
  )
  const quota = thorough ? (plan.intent === "case_request" ? 5 : 3) : 2
  const documents = rankCandidates([...unique.values()], plan.evidenceQueries)
    .map((document, index) => ({
      document,
      index,
      issues: plan.searchQueries.reduce(
        (count, query) =>
          count + Number(normalizeSearchText(document.title).includes(normalizeSearchText(query))),
        0,
      ),
    }))
    .sort(
      (left, right) =>
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
        /(?:방위사업청|방산|군수)/u.test(
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

function laneSummary(
  name: ContentSearchLane["name"],
  sourceTypes: readonly SourceType[],
  response: LegalContentSearchResponse,
): ContentSearchLane {
  return {
    name,
    sourceTypes,
    searched: sourceTypes.length > 0,
    status: response.status,
    errors: response.errors,
    ...(response.coverage === undefined ? {} : { coverage: response.coverage }),
  }
}

function empty(): LegalContentSearchResponse {
  return { status: "NOT_FOUND", results: [], errors: [] }
}
