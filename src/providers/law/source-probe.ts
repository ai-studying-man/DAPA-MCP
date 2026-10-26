import type { LawProvider } from "./law-provider.js"

export async function probeLawSource(law: Pick<LawProvider, "health" | "search" | "getDetail">) {
  const started = Date.now()
  const deadlineAt = started + 5_000
  if (law.health() === "not_configured")
    return {
      state: "not_configured",
      checkedAt: new Date(started).toISOString(),
      elapsedMs: 0,
      errors: [{ code: "AUTH_REQUIRED", message: "LAW_API_OC 설정이 필요합니다" }],
    }
  const list = await law.search({
    query: "방위사업법",
    types: ["law"],
    limit: 1,
    currentOnly: true,
    forceRefresh: true,
    deadlineAt,
  })
  const document = list.results.find((item) => item.title === "방위사업법")
  const body =
    document === undefined
      ? undefined
      : await law.getDetail({
          documentId: document.documentId,
          sourceType: "law",
          currentOnly: true,
          forceRefresh: true,
          deadlineAt,
        })
  const complete =
    list.status === "OK" &&
    body?.status === "OK" &&
    body.detail?.articles.some((article) => article.text.length > 0)
  return {
    state: complete ? "healthy" : "unavailable",
    checkedAt: new Date(started).toISOString(),
    elapsedMs: Date.now() - started,
    listStatus: list.status,
    bodyStatus: body?.status ?? "not_checked",
    errors: [...list.errors, ...(body?.errors ?? [])],
  }
}

export function catalogFreshness(generatedAt: string | undefined, now = Date.now()) {
  const ageMs = generatedAt === undefined ? Number.NaN : now - Date.parse(generatedAt)
  return {
    state: Number.isFinite(ageMs) ? (ageMs > 7 * 86_400_000 ? "stale" : "fresh") : "unknown",
    generatedAt: generatedAt ?? null,
    ageDays: Number.isFinite(ageMs) ? Math.floor(ageMs / 86_400_000) : null,
  }
}
