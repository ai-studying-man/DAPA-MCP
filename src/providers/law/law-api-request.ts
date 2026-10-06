import { DapaError } from "../../lib/errors/dapa-error.js"
import type { LawApiConfig, LawApiInputName } from "./law-api-catalog.js"
import type { LawApiQueryInput } from "./law-api-provider.js"
import { koreaToday, temporalRequest } from "./law-api-temporal.js"

export function buildSearchParams(
  api: LawApiConfig,
  input: LawApiQueryInput,
  apiKey: string,
): Readonly<Record<string, string>> {
  const temporal = temporalRequest(api, input)
  const params: Record<string, string> = {
    OC: apiKey,
    target: temporal.target,
    type: "JSON",
    ...api.staticParameters,
    ...temporal.parameters,
  }
  addInput(params, api.inputParameters?.query, input.query)
  addInput(params, api.inputParameters?.documentId, input.documentId)
  addInput(params, api.inputParameters?.customCode, input.customCode)
  addInput(params, api.inputParameters?.articleNumber, input.articleNumber)
  if (api.paginated === true) {
    params["display"] = String(Math.min(input.limit ?? 20, 100))
    params["page"] = String(input.page ?? 1)
  }
  return params
}

export function apiQueryCacheKey(input: LawApiQueryInput): string {
  return JSON.stringify([
    input.apiId,
    input.query ?? "",
    input.documentId ?? "",
    input.customCode ?? "",
    input.articleNumber ?? "",
    input.limit ?? "",
    input.page ?? "",
    input.currentOnly ?? true,
    input.asOfDate ?? "",
    koreaToday(),
  ])
}

export function inputValue(input: LawApiQueryInput, name: LawApiInputName): string | undefined {
  switch (name) {
    case "query":
      return input.query
    case "documentId":
      return input.documentId
    case "customCode":
      return input.customCode
    case "articleNumber":
      return input.articleNumber
    default:
      return assertNever(name)
  }
}

function addInput(
  params: Record<string, string>,
  parameter: string | undefined,
  value: string | undefined,
): void {
  if (parameter !== undefined && value !== undefined) params[parameter] = value
}

function assertNever(value: never): never {
  throw new DapaError("INTERNAL_ERROR", `처리할 수 없는 입력 형식: ${String(value)}`)
}
