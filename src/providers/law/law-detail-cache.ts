import { TtlCache } from "../../lib/cache/ttl-cache.js"
import type { SearchResponse } from "../../types/results.js"

export class LawDetailCache {
  private readonly cached: TtlCache<SearchResponse>
  private readonly pending = new Map<string, Promise<SearchResponse>>()

  constructor(ttlMs: number) {
    this.cached = new TtlCache(ttlMs)
  }

  getOrLoad(
    key: string,
    forceRefresh: boolean,
    loader: () => Promise<SearchResponse>,
  ): Promise<SearchResponse> {
    if (!forceRefresh) {
      const cached = this.cached.get(key)
      if (cached !== undefined) return Promise.resolve(cached)
    }
    const pending = this.pending.get(key)
    if (pending !== undefined) return pending

    const request = loader().then((response) => {
      if (response.status === "OK") this.cached.set(key, response)
      return response
    })
    this.pending.set(key, request)
    void request.then(
      () => this.pending.delete(key),
      () => this.pending.delete(key),
    )
    return request
  }
}
