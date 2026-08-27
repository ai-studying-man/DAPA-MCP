const TRUNCATION_MESSAGE =
  "응답이 MCP 출력 크기 제한을 초과해 미리보기만 제공합니다. query, page, limit 또는 조문 번호로 범위를 좁혀 다시 조회하세요."

export function stringifyBoundedToolResponse(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value, null, 2)
  if (serialized.length <= maxChars) return serialized

  const record = isRecord(value) ? value : {}
  const envelope = (previewChars: number) =>
    JSON.stringify(
      {
        ...(typeof record["status"] === "string" ? { status: record["status"] } : {}),
        ...(typeof record["apiId"] === "string" ? { apiId: record["apiId"] } : {}),
        ...(typeof record["requestedApiId"] === "string"
          ? { requestedApiId: record["requestedApiId"] }
          : {}),
        truncated: true,
        originalChars: serialized.length,
        maxChars,
        message: TRUNCATION_MESSAGE,
        dataPreview: serialized.slice(0, previewChars),
      },
      null,
      2,
    )

  let lower = 0
  let upper = Math.min(serialized.length, maxChars)
  let best = envelope(0)
  while (lower <= upper) {
    const middle = Math.floor((lower + upper) / 2)
    const candidate = envelope(middle)
    if (candidate.length <= maxChars) {
      best = candidate
      lower = middle + 1
    } else {
      upper = middle - 1
    }
  }
  return best
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
