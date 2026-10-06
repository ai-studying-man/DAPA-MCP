import { expect, it } from "vitest"
import { searchLegalContent } from "../src/providers/law/content-search.js"
import type { LegalDetailInput } from "../src/providers/law/law-provider.js"
import type { DapaSearchResult, SearchResponse } from "../src/types/results.js"

function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error("Deferred promise has not initialized")
  }
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

it("starts the next detail when a worker finishes while preserving order and deadlines", async () => {
  // Given
  const documents: DapaSearchResult[] = Array.from({ length: 6 }, (_, index) => ({
    id: `law:${index}`,
    source: "test",
    sourceType: "law",
    documentId: String(index),
    title: "규정",
    status: "current",
    verified: true,
    retrievedAt: "2026-10-06T00:00:00Z",
  }))
  const pending = documents.map(() => deferred<SearchResponse>())
  const started: LegalDetailInput[] = []
  let active = 0
  let peakActive = 0
  const initialWorkers = deferred<void>()
  const law = {
    search: async () => ({ status: "OK" as const, results: documents, errors: [] }),
    getDetail: (input: LegalDetailInput) => {
      started.push(input)
      active += 1
      peakActive = Math.max(peakActive, active)
      if (started.length === 4) initialWorkers.resolve()
      const slot = pending[Number(input.documentId)]
      if (slot === undefined) throw new RangeError("Unexpected document ID")
      return slot.promise.finally(() => {
        active -= 1
      })
    },
  }
  const deadlineAt = Date.now() + 25_000
  const empty: SearchResponse = { status: "OK", results: [], errors: [] }

  // When: worker 1 finishes while worker 0 remains blocked.
  const response = searchLegalContent(law, {
    query: "시험",
    types: ["law"],
    mode: "thorough",
    limit: 6,
    forceRefresh: true,
    deadlineAt,
  })
  await initialWorkers.promise
  pending[1]?.resolve(empty)
  // Drain the finite promise chain, without elapsed-time waits.
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
  const startedWhileBlocked = started.map((input) => input.documentId)
  const errors = [{ code: "UPSTREAM_FAILURE", message: "Test source unavailable" }]
  pending[2]?.resolve({ status: "SOURCE_UNAVAILABLE", results: [], errors })
  for (const slot of pending) slot.resolve(empty)
  const result = await response

  // Then
  expect(startedWhileBlocked).toEqual(["0", "1", "2", "3", "4"])
  expect(result.results.map((hit) => hit.document.documentId)).toEqual([
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
  ])
  expect(started.every((input) => input.deadlineAt === deadlineAt && input.forceRefresh)).toBe(true)
  expect(peakActive).toBe(4)
  expect(result.status).toBe("PARTIAL_RESULT")
  expect(result.results[2]?.errors).toEqual(errors)
})
