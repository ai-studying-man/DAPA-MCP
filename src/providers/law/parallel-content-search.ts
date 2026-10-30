import type { ResponseStatus, SourceType } from "../../types/results.js"
import { answerEvidence } from "./answer-evidence.js"
import { type CaseContentHit, searchCases } from "./case-content-search.js"
import { planCaseSearch } from "./case-search-plan.js"
import {
  type LegalContentSearchInput,
  type LegalContentSearchResponse,
  searchLegalContent,
} from "./content-search.js"
import type { ContentSearchCoverage } from "./content-search-coverage.js"
import { inferLegalSourceTypes } from "./content-search-plan.js"
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
export type { CaseContentHit } from "./case-content-search.js"
export type ParallelContentSearchResponse = Omit<LegalContentSearchResponse, "results"> & {
  readonly results: readonly CaseContentHit[]
  readonly lanes: readonly ContentSearchLane[]
  readonly answerEvidence: ReturnType<typeof answerEvidence>
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
        : searchWithEvidenceExpansion(law, {
            ...request,
            query: input.types === undefined ? planCaseSearch(input.query).legalQuery : input.query,
            types: legalTypes,
          }),
    ),
    runLane(() =>
      caseTypes.length === 0
        ? Promise.resolve(empty())
        : searchWithEvidenceExpansion(law, request, true),
    ),
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
    answerEvidence: answerEvidence(input.query, results),
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

async function searchWithEvidenceExpansion(
  law: Provider,
  input: LegalContentSearchInput,
  cases = false,
): Promise<LegalContentSearchResponse> {
  const search = cases ? searchCases : searchLegalContent
  const first = await search(law, input)
  const decision = answerEvidence(input.query, first.results).decision
  const insufficient =
    decision === "partial" ||
    (cases && decision === "abstain" && first.status !== "SOURCE_UNAVAILABLE")
  if (input.mode === "thorough" || !insufficient || Date.now() + 1_000 >= (input.deadlineAt ?? 0))
    return first
  const expanded = await search(law, { ...input, mode: "thorough" })
  return answerEvidence(input.query, expanded.results).decision === "grounded" ||
    (cases && expanded.results.some((hit) => hit.status === "OK" && hit.match === "content"))
    ? expanded
    : first
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
