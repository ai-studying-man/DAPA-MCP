import type { LawApiConfig } from "./law-api-catalog.js"
import type { LawApiQueryInput, TemporalScope } from "./law-api-provider.js"

export type TemporalRequest = {
  readonly target: string
  readonly scope: TemporalScope
  readonly parameters: Readonly<Record<string, string>>
}

export function temporalRequest(api: LawApiConfig, input: LawApiQueryInput): TemporalRequest {
  const currentOnly = input.currentOnly ?? true
  if (api.categoryId === "law") {
    if (input.asOfDate !== undefined) {
      const compactDate = input.asOfDate.replaceAll("-", "")
      return {
        target: "eflaw",
        scope: "as_of",
        parameters: { efYd: `${compactDate}~${compactDate}` },
      }
    }
    return {
      target: currentOnly ? "law" : "eflaw",
      scope: currentOnly ? "current" : "all",
      parameters: {},
    }
  }
  if (api.categoryId === "administrative_rule") {
    return {
      target: api.target,
      scope: currentOnly ? "current" : "all",
      parameters: { nw: currentOnly ? "1" : "2" },
    }
  }
  return { target: api.target, scope: "not_applicable", parameters: {} }
}

export function temporalScopeFor(api: LawApiConfig, input: LawApiQueryInput): TemporalScope {
  return temporalRequest(api, input).scope
}
