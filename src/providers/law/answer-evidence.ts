import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { LegalContentHit } from "./content-search.js"
import { planContentSearch } from "./content-search-plan.js"

export function answerEvidence(query: string, hits: readonly LegalContentHit[]) {
  const bodies = hits.filter((hit) => hit.status === "OK" && hit.match === "content")
  const evidence = normalizeSearchText(
    bodies
      .map((hit) =>
        JSON.stringify({
          articles: hit.detail?.articles,
          excerpts: hit.excerpts,
          annexes: hit.detail?.annexes,
          forms: hit.detail?.forms,
          supplementaryProvisions: hit.detail?.supplementaryProvisions,
        }),
      )
      .join("\n"),
  )
  const comparison = /차이|다르|다른|비교/u.test(query)
  const terms = comparison
    ? planContentSearch(query)
        .evidenceQueries.filter((term) => !/제\s*\d+\s*조/u.test(term))
        .slice(0, 2)
    : []
  const missingTerms = terms.filter((term) => !evidence.includes(normalizeSearchText(term)))
  return {
    decision: bodies.length === 0 ? "abstain" : missingTerms.length > 0 ? "partial" : "grounded",
    bodyCount: bodies.length,
    comparisonTerms: terms,
    missingTerms,
    claimVerification: "not_performed",
  } as const
}
