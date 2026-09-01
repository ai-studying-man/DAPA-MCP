import { DapaError } from "../../lib/errors/dapa-error.js"
import type { LegalHistoryResponse } from "../../types/results.js"
import { parseLawHistoryResponse } from "./history.js"
import { sanitizeUrlString } from "./law-api-sanitize.js"
import type { LawHttpClient } from "./law-http.js"

export async function fetchLawHistory(
  http: LawHttpClient,
  apiKey: string,
  input: { readonly lawName: string; readonly limit?: number },
): Promise<LegalHistoryResponse> {
  try {
    const text = await http.get("lawSearch.do", {
      OC: apiKey,
      target: "lsHistory",
      type: "HTML",
      query: input.lawName,
      display: String(Math.min(input.limit ?? 20, 100)),
      sort: "efdes",
    })
    const parsed = parseLawHistoryResponse(text, input.lawName, input.limit ?? 20)
    const status =
      parsed.versions.length > 0 ? "OK" : parsed.totalCount > 0 ? "SOURCE_UNAVAILABLE" : "NOT_FOUND"
    return {
      status,
      lawName: input.lawName,
      totalCount: parsed.totalCount,
      versions: parsed.versions,
      errors:
        parsed.totalCount > 0 && parsed.versions.length === 0
          ? [{ code: "SOURCE_UNAVAILABLE", message: "법제처 연혁 항목을 파싱할 수 없습니다" }]
          : [],
    }
  } catch (error) {
    if (!(error instanceof Error)) {
      return {
        status: "SOURCE_UNAVAILABLE",
        lawName: input.lawName,
        totalCount: 0,
        versions: [],
        errors: [{ code: "INTERNAL_ERROR", message: "알 수 없는 내부 오류" }],
      }
    }
    return {
      status: "SOURCE_UNAVAILABLE",
      lawName: input.lawName,
      totalCount: 0,
      versions: [],
      errors: [toErrorShape(error)],
    }
  }
}

function toErrorShape(error: Error): { readonly code: string; readonly message: string } {
  if (error instanceof DapaError) {
    return { code: error.code, message: sanitizeUrlString(error.message) }
  }
  return { code: "INTERNAL_ERROR", message: sanitizeUrlString(error.message) }
}
