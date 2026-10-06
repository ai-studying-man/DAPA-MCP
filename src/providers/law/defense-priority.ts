import { normalizeSearchText } from "../../lib/normalization/text.js"
import type { DapaSearchResult } from "../../types/results.js"

export function defensePriority(document: DapaSearchResult): number {
  const organization = normalizeSearchText(document.organization ?? "")
  if (/(방위사업청|방사청)/u.test(organization) || defenseTitleScore(document.title) > 0) {
    return 2
  }
  return organization.includes("국방부") ? 1 : 0
}

export function defenseTitleScore(title: string): number {
  return /(방위사업|방위산업|방산|국방전력)/u.test(normalizeSearchText(title)) ? 20 : 0
}
