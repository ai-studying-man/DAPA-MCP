import type { LawApiConfig } from "./law-api-catalog.js"
import type { TemporalScope } from "./law-api-provider.js"

export type TemporalInput = {
  readonly currentOnly?: boolean
  readonly asOfDate?: string
}

export type TemporalRequest = {
  readonly target: string
  readonly scope: TemporalScope
  readonly parameters: Readonly<Record<string, string>>
}

export function koreaToday(now = new Date()): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

export function temporalRequest(
  api: Pick<LawApiConfig, "categoryId" | "target">,
  input: TemporalInput,
): TemporalRequest {
  const currentOnly = input.currentOnly ?? true
  if (api.categoryId === "law") {
    if (input.asOfDate !== undefined) {
      const compactDate = input.asOfDate.replaceAll("-", "")
      return {
        target: "eflaw",
        scope: "as_of",
        parameters: { nw: "1,2,3", efYd: `00010101~${compactDate}`, sort: "efdes" },
      }
    }
    return {
      target: "eflaw",
      scope: currentOnly ? "current" : "all",
      parameters: { nw: currentOnly ? "3" : "1,2,3" },
    }
  }
  if (api.categoryId === "administrative_rule") {
    return {
      target: api.target,
      scope: currentOnly ? "current" : "all",
      parameters: { nw: "1" },
    }
  }
  return { target: api.target, scope: "not_applicable", parameters: {} }
}

export function temporalScopeFor(api: LawApiConfig, input: TemporalInput): TemporalScope {
  return temporalRequest(api, input).scope
}
