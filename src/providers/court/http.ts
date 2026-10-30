import ky from "ky"
import { DapaError } from "../../lib/errors/dapa-error.js"

export function courtBase(value: string, officialHost: string): URL {
  const url = new URL(value)
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    (!local && (url.protocol !== "https:" || url.hostname !== officialHost))
  ) {
    throw new DapaError("INVALID_ARGUMENT", "허용된 법원 출처가 아닙니다")
  }
  return url
}

export async function courtBytes(url: URL, deadlineAt: number, maximum: number): Promise<Buffer> {
  const remaining = deadlineAt - Date.now()
  if (remaining <= 0) throw new DapaError("TIMEOUT", "법원 원문 조회 시간 한도를 초과했습니다")
  const response = await ky.get(url, {
    retry: 0,
    redirect: "manual",
    throwHttpErrors: false,
    timeout: Math.min(remaining, 8_000),
    signal: AbortSignal.timeout(remaining),
  })
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new DapaError("SOURCE_UNAVAILABLE", `법원 원문 HTTP ${response.status}`)
  }
  if (Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel()
    throw new DapaError("SOURCE_UNAVAILABLE", "법원 원문 크기 한도를 초과했습니다")
  }
  const reader = response.body?.getReader()
  if (reader === undefined) throw new DapaError("SOURCE_UNAVAILABLE", "법원 원문 응답이 비었습니다")
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      length += chunk.value.byteLength
      if (length > maximum) {
        await reader.cancel()
        throw new DapaError("SOURCE_UNAVAILABLE", "법원 원문 크기 한도를 초과했습니다")
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks)
}
