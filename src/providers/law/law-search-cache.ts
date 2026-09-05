import { TtlCache } from "../../lib/cache/ttl-cache.js"
import type { DapaSearchResult } from "../../types/results.js"

export class LawSearchCache {
  private readonly cached: TtlCache<readonly DapaSearchResult[]>
  private readonly pending = new Map<string, Promise<readonly DapaSearchResult[]>>()

  constructor(ttlMs: number) {
    this.cached = new TtlCache(ttlMs)
  }

  getOrLoad(
    key: string,
    forceRefresh: boolean,
    loader: () => Promise<readonly DapaSearchResult[]>,
  ): Promise<readonly DapaSearchResult[]> {
    if (!forceRefresh) {
      const cached = this.cached.get(key)
      if (cached !== undefined) return Promise.resolve(cached)
    }
    const pending = this.pending.get(key)
    if (pending !== undefined) return pending

    const request = loader().then((results) => {
      if (results.length > 0) this.cached.set(key, results)
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
