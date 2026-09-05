import ky, { HTTPError, type KyInstance, TimeoutError } from "ky"
import { DapaError } from "../../lib/errors/dapa-error.js"
import { sharedUpstreamGate, type UpstreamGate } from "./upstream-gate.js"

const DEFAULT_REFERER = "https://www.law.go.kr/"
const DEFAULT_USER_AGENT = "dapa-mcp/0.1 (+https://github.com/ai-studying-man/DAPA-MCP)"

export type LawHttpConfig = {
  readonly baseUrl: string
  readonly timeoutMs: number
  readonly retryLimit: number
  readonly maxTextResponseBytes: number
  readonly maxResourceResponseBytes: number
  readonly maxConcurrency?: number
  readonly maxQueue?: number
  readonly referer?: string
  readonly userAgent?: string
}

export type LawHttpResource = {
  readonly bytes: ArrayBuffer
  readonly contentType: string
}

type LawApiResponseKind = "json" | "html"

export class LawHttpClient {
  private readonly client: KyInstance
  private readonly resourceClient: KyInstance
  private readonly usableResponseRetryLimit: number
  private readonly maxTextResponseBytes: number
  private readonly maxResourceResponseBytes: number
  private readonly gate: UpstreamGate
  private readonly timeoutMs: number

  constructor(config: LawHttpConfig) {
    this.usableResponseRetryLimit = config.retryLimit
    this.maxTextResponseBytes = config.maxTextResponseBytes
    this.maxResourceResponseBytes = config.maxResourceResponseBytes
    this.gate = sharedUpstreamGate(
      config.baseUrl,
      config.maxConcurrency ?? 8,
      config.maxQueue ?? 128,
    )
    this.timeoutMs = config.timeoutMs
    const headers = {
      referer: config.referer ?? DEFAULT_REFERER,
      "user-agent": config.userAgent ?? DEFAULT_USER_AGENT,
    }
    this.client = ky.create({
      prefix: config.baseUrl,
      headers,
      timeout: config.timeoutMs,
      retry: {
        limit: config.retryLimit,
        methods: ["get"],
        statusCodes: [429, 500, 502, 503, 504],
      },
    })
    this.resourceClient = ky.create({
      headers,
      timeout: config.timeoutMs,
      redirect: "error",
      retry: {
        limit: config.retryLimit,
        methods: ["get"],
        statusCodes: [429, 500, 502, 503, 504],
      },
    })
  }

  async get(
    endpoint: string,
    searchParams: Readonly<Record<string, string>>,
    deadlineAt?: number,
  ): Promise<string> {
    return this.getText(endpoint, searchParams, "json", deadlineAt)
  }

  async getHtml(endpoint: string, searchParams: Readonly<Record<string, string>>): Promise<string> {
    return this.getText(endpoint, searchParams, "html")
  }

  private async getText(
    endpoint: string,
    searchParams: Readonly<Record<string, string>>,
    responseKind: LawApiResponseKind,
    deadlineAt?: number,
  ): Promise<string> {
    return this.gate.run(
      async () => {
        try {
          for (let attempt = 0; attempt <= this.usableResponseRetryLimit; attempt += 1) {
            const response = await this.client.get(endpoint, {
              searchParams,
              timeout: this.requestTimeoutMs(deadlineAt),
            })
            const bytes = await readBoundedResponse(response, this.maxTextResponseBytes)
            const text = new TextDecoder().decode(bytes)
            if (isUsableApiResponse(text, response.headers.get("content-type"), responseKind)) {
              return text
            }
          }
          throw new DapaError(
            "SOURCE_UNAVAILABLE",
            "법제처 API가 빈 응답 또는 점검 페이지를 반환했습니다",
          )
        } catch (error) {
          if (!(error instanceof Error)) {
            throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API에 연결할 수 없습니다")
          }
          throwLawHttpError(error)
        }
      },
      deadlineAt === undefined ? {} : { deadlineAt },
    )
  }

  private requestTimeoutMs(deadlineAt: number | undefined): number {
    if (deadlineAt === undefined) return this.timeoutMs
    const remaining = deadlineAt - Date.now()
    if (remaining <= 0) {
      throw new DapaError("TIMEOUT", "법령 검색의 전체 시간 한도를 초과했습니다")
    }
    return Math.min(this.timeoutMs, remaining)
  }

  async getResource(url: URL): Promise<LawHttpResource> {
    return this.gate.run(async () => {
      try {
        const response = await this.resourceClient.get(url)
        return {
          bytes: await readBoundedResponse(response, this.maxResourceResponseBytes),
          contentType: response.headers.get("content-type") ?? "application/octet-stream",
        }
      } catch (error) {
        if (!(error instanceof Error)) {
          throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API에 연결할 수 없습니다")
        }
        throwLawHttpError(error)
      }
    })
  }
}

function isUsableApiResponse(
  text: string,
  contentType: string | null,
  responseKind: LawApiResponseKind,
): boolean {
  const normalized = text.trimStart().toLowerCase()
  if (normalized.length === 0) return false
  switch (responseKind) {
    case "html":
      return true
    case "json":
      return (
        !contentType?.toLowerCase().includes("text/html") &&
        !normalized.startsWith("<!doctype html") &&
        !normalized.startsWith("<html") &&
        !normalized.includes("location.assign(")
      )
    default:
      return assertNever(responseKind)
  }
}

function assertNever(value: never): never {
  throw new DapaError("INTERNAL_ERROR", `처리되지 않은 법제처 응답 형식: ${String(value)}`)
}

async function readBoundedResponse(response: Response, maxBytes: number): Promise<ArrayBuffer> {
  const declaredLength = Number(response.headers.get("content-length"))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw responseSizeError(maxBytes)
  }
  if (response.body === null) return new ArrayBuffer(0)

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    totalBytes += result.value.byteLength
    if (totalBytes > maxBytes) {
      void reader.cancel()
      throw responseSizeError(maxBytes)
    }
    chunks.push(result.value)
  }

  const combined = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return combined.buffer
}

function responseSizeError(maxBytes: number): DapaError {
  return new DapaError(
    "SOURCE_UNAVAILABLE",
    `법제처 API 응답 크기 제한(${maxBytes}바이트)을 초과했습니다`,
  )
}

function throwLawHttpError(error: Error): never {
  if (error instanceof DapaError) throw error
  if (error instanceof TimeoutError) {
    throw new DapaError("TIMEOUT", "법제처 API 요청 시간이 초과되었습니다", { cause: error })
  }
  if (error instanceof HTTPError) {
    const status = error.response.status
    if (status === 429) {
      throw new DapaError("RATE_LIMITED", "법제처 API 요청 한도를 초과했습니다", {
        cause: error,
      })
    }
    if (status === 401 || status === 403) {
      throw new DapaError("AUTH_REQUIRED", "법제처 API 인증값을 확인해야 합니다", {
        cause: error,
      })
    }
    throw new DapaError("SOURCE_UNAVAILABLE", `법제처 API가 HTTP ${status}를 반환했습니다`, {
      cause: error,
    })
  }
  throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API에 연결할 수 없습니다", {
    cause: error,
  })
}
