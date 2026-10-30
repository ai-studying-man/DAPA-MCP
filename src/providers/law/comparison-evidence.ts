import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { LegalArticle } from "../../types/results.js"
import type { LegalContentHit } from "./content-search.js"

export function isDefinitionEvidence(article: LegalArticle, term: string): boolean {
  if (!/정의/u.test(article.title ?? "")) return false
  return definesTerm(article.text, term)
}

function definesTerm(text: string, term: string): boolean {
  const body = normalizeSearchText(text)
  const key = normalizeSearchText(term)
  const index = body.indexOf(key)
  return index >= 0 && /^(?:이라함은|이란|란|의정의|정의)/u.test(body.slice(index + key.length))
}

export function comparisonEvidence(terms: readonly string[], hits: readonly LegalContentHit[]) {
  return terms.map((term) => {
    const references = hits.flatMap((hit) => {
      const articles = (hit.detail?.articles ?? []).filter((article) => {
        const title = normalizeSearchText(article.title ?? "")
        const key = normalizeSearchText(term)
        const body = normalizeSearchText(article.text)
        const forwardingOnly =
          /지침|규정|기준|에따라|따른다/u.test(body) &&
          !/다음각호|예산편성|소요결정|조사.{0,30}분석|요구서|계획서|대상사업|대상은|목적은|[0-9]+억원/u.test(
            body,
          )
        return (
          isDefinitionEvidence(article, term) ||
          (body.includes(key) &&
            !forwardingOnly &&
            /하여야한다|해야한다|할수있다|수행한다|실시한다|말한다|조사.{0,30}분석|다음각호|예산편성|소요결정|목적|이상인/u.test(
              normalizeSearchText(article.text),
            ) &&
            (title === key ||
              ["대상", "목적", "실시", "수행", "기준", "절차", "기본원칙"].some(
                (role) => title === key + role || title === `${key}의${role}`,
              )))
        )
      })
      return [
        ...articles.map((article) => ({
          documentId: hit.document.documentId,
          article:
            article.articleNumber + (article.branch === undefined ? "" : `의${article.branch}`),
          sourceUrl: hit.document.sourceUrl,
          effectiveDate: hit.document.effectiveDate,
          excerpt: article.text.slice(0, 1200),
          truncated: article.text.length > 1200,
        })),
        ...(hit.excerpts ?? [])
          .filter((text) => definesTerm(text, term))
          .map((excerpt) => ({
            documentId: hit.document.documentId,
            sourceUrl: hit.document.sourceUrl,
            excerpt,
          })),
      ]
    })
    const mentioned = hits.some((hit) =>
      normalizeSearchText(
        JSON.stringify({
          articles: hit.detail?.articles.map((article) => article.text),
          excerpts: hit.excerpts,
        }),
      ).includes(normalizeSearchText(term)),
    )
    return {
      term,
      coverage: references.length > 0 ? "primary_evidence" : mentioned ? "mention_only" : "missing",
      references,
    } as const
  })
}
