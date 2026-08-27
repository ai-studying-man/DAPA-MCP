import ky, { HTTPError, type KyInstance, TimeoutError } from "ky"
import { DapaError } from "../../lib/errors/dapa-error.js"

export type LawHttpConfig = {
  readonly baseUrl: string
  readonly timeoutMs: number
  readonly retryLimit: number
  readonly maxTextResponseBytes: number
  readonly maxResourceResponseBytes: number
}

export type LawHttpResource = {
  readonly bytes: ArrayBuffer
  readonly contentType: string
}

export class LawHttpClient {
  private readonly client: KyInstance
  private readonly resourceClient: KyInstance
  private readonly maxTextResponseBytes: number
  private readonly maxResourceResponseBytes: number

  constructor(config: LawHttpConfig) {
    this.maxTextResponseBytes = config.maxTextResponseBytes
    this.maxResourceResponseBytes = config.maxResourceResponseBytes
    this.client = ky.create({
      prefix: config.baseUrl,
      timeout: config.timeoutMs,
      retry: {
        limit: config.retryLimit,
        methods: ["get"],
        statusCodes: [429, 500, 502, 503, 504],
      },
    })
    this.resourceClient = ky.create({
      timeout: config.timeoutMs,
      redirect: "error",
      retry: {
        limit: config.retryLimit,
        methods: ["get"],
        statusCodes: [429, 500, 502, 503, 504],
      },
    })
  }

  async get(endpoint: string, searchParams: Readonly<Record<string, string>>): Promise<string> {
    try {
      const response = await this.client.get(endpoint, { searchParams })
      const bytes = await readBoundedResponse(response, this.maxTextResponseBytes)
      return new TextDecoder().decode(bytes)
    } catch (error) {
      if (!(error instanceof Error)) {
        throw new DapaError("SOURCE_UNAVAILABLE", "법제처 API에 연결할 수 없습니다")
      }
      throwLawHttpError(error)
    }
  }

  async getResource(url: URL): Promise<LawHttpResource> {
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
  }
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
