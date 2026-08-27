type CacheEntry<T> = {
  readonly value: T
  readonly expiresAt: number
}

export class TtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>()

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries = 100,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T): void {
    if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
      const oldest = this.entries.keys().next().value
      if (oldest !== undefined) this.entries.delete(oldest)
    }
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs })
  }
}
