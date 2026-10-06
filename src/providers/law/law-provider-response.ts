import { DapaError } from "../../lib/errors/dapa-error.js"
import type { SearchResponse } from "../../types/results.js"
import { sanitizeUrlString } from "./law-api-sanitize.js"

export async function waitForDeadline<T>(
  request: Promise<T>,
  deadlineAt: number | undefined,
): Promise<T> {
  if (deadlineAt === undefined) return request
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) {
    throw new DapaError("TIMEOUT", "법령 검색의 전체 시간 한도를 초과했습니다")
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new DapaError("TIMEOUT", "법령 검색의 전체 시간 한도를 초과했습니다")),
      remaining,
    )
  })
  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export function unavailable(code: string, message: string): SearchResponse {
  return { status: "SOURCE_UNAVAILABLE", results: [], errors: [{ code, message }] }
}

export function toErrorShape(error: unknown): { readonly code: string; readonly message: string } {
  if (error instanceof DapaError) {
    return { code: error.code, message: sanitizeUrlString(error.message) }
  }
  if (error instanceof Error) {
    return { code: "INTERNAL_ERROR", message: sanitizeUrlString(error.message) }
  }
  return { code: "INTERNAL_ERROR", message: "알 수 없는 내부 오류" }
}
