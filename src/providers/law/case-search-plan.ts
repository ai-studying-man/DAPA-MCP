import { normalizeSearchText } from "../../lib/normalization/text.js"
import { planContentSearch } from "./content-search-plan.js"

export type CaseSearchPlan = {
  readonly intent: "comparison" | "case_request"
  readonly searchQueries: readonly string[]
  readonly evidenceQueries: readonly string[]
  readonly legalQuery: string
}

const ISSUE_ROUTES = [
  { trigger: /(?:입찰참가|부정당|입찰제한|입찰자격)/u, terms: ["입찰참가자격제한", "부정당업자"] },
  {
    trigger: /(?:품질|규격|성능).*(?:미달|부족|불량)|(?:미달|불량).*(?:납품|물품)/u,
    terms: ["입찰참가자격제한", "부정한 제조", "규격 미달"],
  },
  {
    trigger: /(?:계약해지|계약해제|계약을해지|계약을해제)/u,
    terms: ["계약해지", "계약해제", "손해배상"],
  },
  { trigger: /(?:지체상금|납기|납품지연)/u, terms: ["지체상금", "납품지연"] },
  { trigger: /(?:손해배상|배상책임)/u, terms: ["손해배상", "계약불이행"] },
  { trigger: /(?:원가|부당이득|부당이익)/u, terms: ["부당이득", "방산원가"] },
] as const

export function planCaseSearch(query: string): CaseSearchPlan {
  const normalized = normalizeSearchText(query)
  const mapped = ISSUE_ROUTES.filter((route) => route.trigger.test(normalized)).flatMap(
    (route) => route.terms,
  )
  const clean = query.replace(
    /(?:판례|사례|소송|분쟁|법원|대법원|방위사업청|방사청|방위사업|방산|알려주세요|알려줘|어떻게|궁금해|있나요|있어)/gu,
    " ",
  )
  const filler = new Set([
    "관련",
    "내용",
    "것",
    "뭐야",
    "어떤",
    "있을까",
    "알려",
    "있니",
    "사례가",
    "판례가",
    "있을까요",
    "진행해",
  ])
  const fallback = planContentSearch(clean).evidenceQueries.filter(
    (term) => term.length >= 2 && !filler.has(term),
  )
  const terms = [...new Set([...mapped, ...fallback])]
  const qualityIssue = /(?:품질|규격|성능).*(?:미달|부족|불량)/u.test(normalized)
  return {
    intent: /(?:판례|사례|소송|분쟁|법원|제재|책임|위법|적법)/u.test(query)
      ? "case_request"
      : "comparison",
    searchQueries: qualityIssue
      ? [...new Set(["입찰참가자격제한", "부정한 제조", ...terms])]
      : terms,
    evidenceQueries: qualityIssue
      ? ["부정한 제조", "품질 미달", "규격 미달", "성능 미달", "품질", "규격"]
      : terms,
    legalQuery:
      qualityIssue || /(?:입찰참가|부정당|입찰제한|입찰자격)/u.test(normalized)
        ? "입찰참가자격제한"
        : query,
  }
}
