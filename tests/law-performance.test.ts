import { afterEach, describe, expect, it, vi } from "vitest"
import {
  measureLawParse,
  recordLawCache,
  withLawPerformance,
} from "../src/providers/law/law-performance.js"
import { LawProvider } from "../src/providers/law/law-provider.js"
import { startFakeLawApi } from "./helpers/fake-law-api.js"

afterEach(() => vi.restoreAllMocks())

describe("law performance telemetry", () => {
  it("preserves results and original errors when the diagnostic stream throws", async () => {
    // Given
    vi.spyOn(process.stderr, "write").mockImplementation(() => {
      throw new Error("closed diagnostic stream")
    })
    const original = new Error("original operation failure")
    // When
    const success = withLawPerformance(true, async () => {
      recordLawCache("search", "hit")
      return 42
    })
    const failure = withLawPerformance(true, async () => {
      throw original
    })
    // Then
    await Promise.all([expect(success).resolves.toBe(42), expect(failure).rejects.toBe(original)])
  })
  it("records HTTP, parse and cache decisions without leaking upstream credentials", async () => {
    // Given
    const output = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    const api = await startFakeLawApi((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ LawSearch: { totalCnt: "0", law: [] } }))
    })
    const law = new LawProvider({ apiKey: "private-test-oc", baseUrl: api.baseUrl })
    try {
      // When
      await withLawPerformance(true, async () => {
        await law.search({ query: "private-query", limit: 5 })
        await law.search({ query: "private-query", limit: 10 })
      })
      // Then
      const events = output.mock.calls.map(([line]) => JSON.parse(String(line)))
      expect(events.map((event) => event.stage)).toEqual([
        "cache",
        "upstream",
        "parse",
        "cache",
        "request",
      ])
      expect(events[1]).toMatchObject({ operation: "list", success: true })
      expect(events[1]?.queueMs).toBeGreaterThanOrEqual(0)
      expect(events[3]).toMatchObject({ cache: "search", outcome: "hit" })
      expect(new Set(events.map((event) => event.requestId)).size).toBe(1)
      const logged = JSON.stringify(events)
      expect(logged).not.toContain("private-test-oc")
      expect(logged).not.toContain("private-query")
      expect(logged).not.toContain(api.baseUrl)
    } finally {
      await api.close()
    }
  })
  it("records correlated numeric timings without recording request content", async () => {
    // Given
    const output = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    // When
    const result = await withLawPerformance(true, async () => {
      recordLawCache("search", "hit")
      return measureLawParse(() => "private document text")
    })
    // Then
    expect(result).toBe("private document text")
    const events = output.mock.calls.map(([line]) => JSON.parse(String(line)))
    expect(events.map((event) => event.stage)).toEqual(["cache", "parse", "request"])
    expect(new Set(events.map((event) => event.requestId)).size).toBe(1)
    expect(events.every((event) => typeof event.durationMs === "number")).toBe(true)
    expect(JSON.stringify(events)).not.toContain("private document text")
  })

  it("stays silent when disabled and preserves failures", async () => {
    // Given
    const output = vi.spyOn(process.stderr, "write").mockReturnValue(true)
    const failure = new Error("private error")
    // When
    const request = withLawPerformance(false, async () => {
      recordLawCache("search", "miss")
      throw failure
    })
    // Then
    await expect(request).rejects.toBe(failure)
    expect(output).not.toHaveBeenCalled()
  })
})
