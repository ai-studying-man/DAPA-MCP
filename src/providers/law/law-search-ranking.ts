import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { DapaSearchResult } from "../../types/results.js"

export function rankSearchResults(
  results: readonly DapaSearchResult[],
  query: string,
): readonly DapaSearchResult[] {
  const normalizedQuery = normalizeSearchText(query)
  const queryTokens = query
    .split(/[^0-9A-Za-z가-힣]+/u)
    .map(normalizeSearchText)
    .filter((token) => token.length >= 2)
  return results
    .map((result, index) => ({
      result,
      index,
      score: titleScore(normalizeSearchText(result.title), normalizedQuery, queryTokens),
    }))
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ result }) => result)
}

function titleScore(title: string, query: string, queryTokens: readonly string[]): number {
  if (title === query) return 4
  if (title.startsWith(query) || title.endsWith(query)) return 3
  if (title.includes(query)) return 2
  return queryTokens.length > 0 && queryTokens.every((token) => title.includes(token)) ? 1 : 0
}
