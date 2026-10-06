import { AsyncLocalStorage } from "node:async_hooks"
import { randomUUID } from "node:crypto"

const traces = new AsyncLocalStorage<string>()

type PerformanceEvent = {
  readonly stage: "request" | "upstream" | "parse" | "cache"
  readonly durationMs: number
  readonly queueMs?: number
  readonly cache?: "search" | "detail"
  readonly outcome?: "hit" | "miss" | "shared"
  readonly success?: boolean
  readonly completed?: boolean
  readonly operation?: "list" | "body" | "resource"
}

// The allowlisted event shape deliberately excludes URLs, OC, queries and document content.
export function recordLawPerformance(event: PerformanceEvent): void {
  const requestId = traces.getStore()
  if (requestId === undefined) return
  try {
    process.stderr.write(`${JSON.stringify({ event: "law.performance", requestId, ...event })}\n`)
  } catch {
    // no-excuse-ok: catch — a diagnostic sink must never change an API result or error.
    return
  }
}

export async function withLawPerformance<T>(
  enabled: boolean,
  operation: () => Promise<T>,
): Promise<T> {
  if (!enabled) return operation()
  return traces.run(randomUUID(), async () => {
    const started = performance.now()
    let completed = false
    try {
      const result = await operation()
      completed = true
      return result
    } finally {
      recordLawPerformance({ stage: "request", durationMs: performance.now() - started, completed })
    }
  })
}

export function measureLawParse<T>(operation: () => T, kind: "list" | "body" = "body"): T {
  const started = performance.now()
  try {
    return operation()
  } finally {
    recordLawPerformance({
      stage: "parse",
      operation: kind,
      durationMs: performance.now() - started,
    })
  }
}

export function recordLawCache(
  cache: "search" | "detail",
  outcome: "hit" | "miss" | "shared",
): void {
  recordLawPerformance({ stage: "cache", durationMs: 0, cache, outcome })
}
