import { DapaError } from "../../lib/errors/dapa-error.js"

type GateOptions = {
  readonly deadlineAt?: number
}

export interface UpstreamGate {
  run<T>(operation: () => Promise<T>, options?: GateOptions): Promise<T>
}

class BoundedUpstreamGate implements UpstreamGate {
  private active = 0
  private readonly waiting: Waiter[] = []

  constructor(
    private readonly limit: number,
    private readonly maxQueue: number,
  ) {}

  async run<T>(operation: () => Promise<T>, options: GateOptions = {}): Promise<T> {
    await this.acquire(options.deadlineAt)
    try {
      return await operation()
    } finally {
      this.release()
    }
  }

  private acquire(deadlineAt: number | undefined): Promise<void> {
    if (deadlineAt !== undefined && deadlineAt <= Date.now()) return Promise.reject(timeoutError())
    if (this.active < this.limit) {
      this.active += 1
      return Promise.resolve()
    }
    if (this.waiting.length >= this.maxQueue) {
      return Promise.reject(
        new DapaError("RATE_LIMITED", "법령 API 서버의 대기 요청이 너무 많습니다"),
      )
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        resolve,
        reject,
        ...(deadlineAt === undefined ? {} : { deadlineAt }),
      }
      this.waiting.push(waiter)
      if (deadlineAt !== undefined) {
        waiter.timer = setTimeout(
          () => {
            const index = this.waiting.indexOf(waiter)
            if (index >= 0) this.waiting.splice(index, 1)
            reject(timeoutError())
          },
          Math.max(deadlineAt - Date.now(), 0),
        )
      }
    })
  }

  private release(): void {
    this.active -= 1
    while (this.waiting.length > 0) {
      const waiter = this.waiting.shift()
      if (waiter === undefined) return
      if (waiter.deadlineAt !== undefined && waiter.deadlineAt <= Date.now()) {
        if (waiter.timer !== undefined) clearTimeout(waiter.timer)
        waiter.reject(timeoutError())
        continue
      }
      if (waiter.timer !== undefined) clearTimeout(waiter.timer)
      this.active += 1
      waiter.resolve()
      return
    }
  }
}

const sharedGates = new Map<string, UpstreamGate>()

export function sharedUpstreamGate(baseUrl: string, limit: number, maxQueue: number): UpstreamGate {
  const key = `${baseUrl}:${limit}:${maxQueue}`
  const existing = sharedGates.get(key)
  if (existing !== undefined) return existing
  const gate = new BoundedUpstreamGate(limit, maxQueue)
  sharedGates.set(key, gate)
  return gate
}

type Waiter = {
  readonly resolve: () => void
  readonly reject: (error: DapaError) => void
  readonly deadlineAt?: number
  timer?: ReturnType<typeof setTimeout>
}

function timeoutError(): DapaError {
  return new DapaError("TIMEOUT", "법령 검색의 전체 시간 한도를 초과했습니다")
}
