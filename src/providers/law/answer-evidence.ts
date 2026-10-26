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
  const context = requiredCaseContext(query, bodies)
  missingTerms.push(...context.missingTerms)
  return {
    decision: bodies.length === 0 ? "abstain" : missingTerms.length > 0 ? "partial" : "grounded",
    bodyCount: bodies.length,
    comparisonTerms: terms,
    missingTerms,
    requiredContext: context.requiredTerms,
    claimVerification: "not_performed",
  } as const
}

function requiredCaseContext(query: string, hits: readonly LegalContentHit[]) {
  const cases = hits.filter((hit) =>
    ["precedent", "constitutional_case"].includes(hit.document.sourceType),
  )
  const required = [
    { trigger: /입찰참가|부정당/u, label: "입찰참가자격 제한", pattern: /입찰참가|부정당/u },
    { trigger: /군사기밀/u, label: "군사기밀", pattern: /군사기밀|軍事機密/u },
    { trigger: /직업.*자유/u, label: "직업의 자유", pattern: /직업.*자유|職業.*自由/u },
    { trigger: /지체상금/u, label: "지체상금", pattern: /지체상금/u },
    {
      trigger: /방위사업청|방산|군수품/u,
      label: "방위사업 관련 사실관계",
      pattern: /방위사업청|방산물자|군수품/u,
    },
  ].filter(({ trigger }) => trigger.test(query))
  if (cases.length === 0 || required.length === 0) return { requiredTerms: [], missingTerms: [] }
  const texts = cases.map((hit) =>
    normalizeSearchText(
      JSON.stringify({
        articles: hit.detail?.articles,
        excerpts: hit.excerpts,
      }),
    ),
  )
  const relevant = texts.some((text) => required.every(({ pattern }) => pattern.test(text)))
  return {
    requiredTerms: required.map(({ label }) => label),
    missingTerms: relevant
      ? []
      : required
          .filter(({ pattern }) => !texts.some((text) => pattern.test(text)))
          .map(({ label }) => label)
          .concat(
            required.every(({ pattern }) => texts.some((text) => pattern.test(text)))
              ? ["동일 사건에서 핵심 쟁점의 연관성"]
              : [],
          ),
  }
}
