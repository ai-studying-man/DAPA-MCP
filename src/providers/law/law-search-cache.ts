import { TtlCache } from "../../lib/cache/ttl-cache.js"
import type { DapaSearchResult } from "../../types/results.js"
import { recordLawCache } from "./law-performance.js"

export class LawSearchCache<T = readonly DapaSearchResult[]> {
  private readonly cached: TtlCache<{
    readonly results: T
    readonly expiresAt: number
  }>
  private readonly pending = new Map<string, Promise<T>>()

  constructor(
    private readonly ttlMs: number,
    private readonly isEmpty: (value: T) => boolean = (value) =>
      Array.isArray(value) && value.length === 0,
  ) {
    this.cached = new TtlCache(ttlMs)
  }

  getOrLoad(key: string, forceRefresh: boolean, loader: () => Promise<T>): Promise<T> {
    if (!forceRefresh) {
      const cached = this.cached.get(key)
      if (cached !== undefined && cached.expiresAt > Date.now()) {
        recordLawCache("search", "hit")
        return Promise.resolve(cached.results)
      }
    }
    const pending = this.pending.get(key)
    if (pending !== undefined) {
      recordLawCache("search", "shared")
      return pending
    }

    recordLawCache("search", "miss")
    const request = loader().then((results) => {
      this.cached.set(key, {
        results,
        expiresAt: Date.now() + (this.isEmpty(results) ? Math.min(this.ttlMs, 30_000) : this.ttlMs),
      })
      return results
    })
    this.pending.set(key, request)
    void request.then(
      () => this.pending.delete(key),
      () => this.pending.delete(key),
    )
    return request
  }
}
