import { z } from "zod"
import { parseCitation } from "../../lib/citation/parser.js"
import type { SearchResponse } from "../../types/results.js"
import { answerEvidence } from "./answer-evidence.js"
import { planCaseSearch } from "./case-search-plan.js"
import type { LegalContentSearchInput } from "./content-search.js"
import { extractExcerptEvidence } from "./content-search-evidence.js"
import type { LawProvider } from "./law-provider.js"
import { toErrorShape, waitForDeadline } from "./law-provider-response.js"
import { searchLegalContentParallel } from "./parallel-content-search.js"

export async function searchWithCourtFallback(
  law: Pick<LawProvider, "search" | "getDetail">,
  input: LegalContentSearchInput,
  court?: Pick<LawProvider, "search">,
) {
  const eligible =
    court !== undefined &&
    input.asOfDate === undefined &&
    (input.types === undefined || input.types.includes("precedent")) &&
    /지체상금|지연배상금/u.test(input.query)
  const deadlineAt = input.deadlineAt ?? Date.now() + (input.timeBudgetMs ?? 25_000)
  const primary = await searchLegalContentParallel(law, {
    ...input,
    deadlineAt: eligible ? Math.max(Date.now(), deadlineAt - 7_000) : deadlineAt,
  })
  if (!eligible || court === undefined) return primary
  let official: SearchResponse
  try {
    official = await waitForDeadline(court.search({ ...input, deadlineAt, limit: 1 }), deadlineAt)
  } catch (error) {
    official = { status: "SOURCE_UNAVAILABLE", results: [], errors: [toErrorShape(error)] }
  }
  const hits = official.results.map(({ content, ...document }) => {
    const evidence = extractExcerptEvidence(content, planCaseSearch(input.query).evidenceQueries)
    const originalSource = courtOriginalSource(content)
    return {
      document,
      status: official.status,
      match: evidence.excerpts.length > 0 ? ("content" as const) : ("metadata" as const),
      excerpts: evidence.excerpts,
      evidenceCoverage: evidence.coverage,
      caseRelevance: "unverified" as const,
      ...(originalSource === undefined ? {} : { originalSource }),
      errors: official.errors,
    }
  })
  const lawApiExactLookups = await Promise.all(
    official.results.map(async (document) => {
      const caseNumber = parseCitation(`대법원 ${document.summary ?? ""}`).caseNumber
      if (caseNumber === undefined) return { caseNumber: null, status: "not_checked" }
      const response = await law.search({
        query: caseNumber,
        caseNumber,
        types: ["precedent"],
        currentOnly: false,
        forceRefresh: input.forceRefresh === true,
        limit: 20,
        deadlineAt,
      })
      return {
        caseNumber,
        status: response.status,
        matches: response.results.length,
        scope: "exact_docket_in_public_law_api",
        errors: response.errors,
      }
    }),
  )
  const results = [...hits, ...primary.results]
  const errors = [...primary.errors, ...official.errors]
  return {
    ...primary,
    status:
      errors.length > 0
        ? results.length > 0
          ? ("PARTIAL_RESULT" as const)
          : ("SOURCE_UNAVAILABLE" as const)
        : results.length > 0
          ? ("OK" as const)
          : primary.status,
    results,
    errors,
    answerEvidence: answerEvidence(input.query, results),
    officialCourt: {
      status: official.status,
      originalBodies: hits.filter((hit) => hit.match === "content").length,
      scope: "bounded_published_court_notices",
      partyContextVerification: "not_performed",
      lawApiExactLookups,
      errors: official.errors,
    },
  }
}

function courtOriginalSource(content: string | undefined) {
  if (content === undefined) return undefined
  try {
    const result = z
      .object({
        sourceUrl: z.url(),
        attachmentUrl: z.url(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        pageCount: z.number().optional(),
        truncated: z.boolean(),
        originalCharacters: z.number(),
      })
      .safeParse(JSON.parse(content))
    return result.success
      ? { ...result.data, evidenceKind: "court_judgment_original", partyContext: "not_verified" }
      : undefined
  } catch {
    return undefined
  }
}
