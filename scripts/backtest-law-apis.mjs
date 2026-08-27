import { getLawApiConfig, LAW_API_IDS } from "../dist/providers/law/law-api-catalog.js"
import { LawApiProvider } from "../dist/providers/law/law-api-provider.js"

const apiKey = process.env.LAW_API_OC
if (apiKey === undefined || apiKey.length === 0) {
  process.stderr.write("LAW_API_OC 환경변수가 필요합니다.\n")
  process.exitCode = 2
} else {
  const provider = new LawApiProvider({
    apiKey,
    timeoutMs: Number(process.env.LAW_API_BACKTEST_TIMEOUT_MS ?? 90_000),
    retryLimit: 1,
    cacheTtlMs: 300_000,
  })

  const sourceResponses = new Map()
  const sourceInputs = new Map([
    ["pre_consultation_opinion.list", {}],
    ["central_ministry_interpretation.dapa_list", { query: "방위사업" }],
    ["legal_term.list", { query: "과태료" }],
    ["treaty.list", {}],
    ["constitutional_case.list", {}],
    ["interpretation.list", {}],
    ["administrative_appeal.list", {}],
    ["law.list", { query: "방위사업법" }],
    ["administrative_rule.list", { query: "방위사업관리규정" }],
    ["local_ordinance.list", { query: "조례" }],
    ["precedent.list", { query: "손해배상" }],
  ])
  const detailSources = new Map([
    ["pre_consultation_opinion.detail", "pre_consultation_opinion.list"],
    ["central_ministry_interpretation.dapa_detail", "central_ministry_interpretation.dapa_list"],
    ["legal_term.detail", "legal_term.list"],
    ["treaty.detail", "treaty.list"],
    ["constitutional_case.detail", "constitutional_case.list"],
    ["interpretation.detail", "interpretation.list"],
    ["administrative_appeal.detail", "administrative_appeal.list"],
    ["law.detail", "law.list"],
    ["administrative_rule.detail", "administrative_rule.list"],
    ["local_ordinance.detail", "local_ordinance.list"],
    ["precedent.detail", "precedent.list"],
  ])
  const directInputs = new Map([
    ["legal_knowledge_base.legal_terms", { query: "과태료" }],
    ["legal_knowledge_base.daily_terms", { query: "세금" }],
    ["legal_knowledge_base.legal_to_daily", { query: "과태료" }],
    ["legal_knowledge_base.daily_to_legal", { query: "세금" }],
    ["legal_knowledge_base.legal_to_articles", { query: "과태료" }],
    ["legal_knowledge_base.article_to_legal", { query: "도로교통법", articleNumber: "001600" }],
    ["legal_knowledge_base.ai_search", { query: "방위사업 계약" }],
    ["legal_knowledge_base.ai_related_laws", { query: "방위사업 계약" }],
    ["customized.law_list", { customCode: process.env.LAW_API_LAW_VCODE ?? "L0000000003384" }],
    ["customized.law_articles", { customCode: process.env.LAW_API_LAW_VCODE ?? "L0000000003384" }],
    [
      "customized.administrative_rule_list",
      { customCode: process.env.LAW_API_ADMIN_RULE_VCODE ?? "A0000000000601" },
    ],
    [
      "customized.administrative_rule_articles",
      { customCode: process.env.LAW_API_ADMIN_RULE_VCODE ?? "A0000000000601" },
    ],
    [
      "customized.local_ordinance_list",
      { customCode: process.env.LAW_API_ORDINANCE_VCODE ?? "O0000000000602" },
    ],
    [
      "customized.local_ordinance_articles",
      { customCode: process.env.LAW_API_ORDINANCE_VCODE ?? "O0000000000602" },
    ],
    ["attachment_form.law_list", {}],
    ["attachment_form.administrative_rule_list", {}],
    ["attachment_form.local_ordinance_list", {}],
  ])
  const officialFallbacks = new Map([["pre_consultation_opinion.detail", { documentId: "30" }]])

  async function sourceResponse(apiId) {
    const cached = sourceResponses.get(apiId)
    if (cached !== undefined) return cached
    const promise = provider.query({
      apiId,
      ...sourceInputs.get(apiId),
      limit: 1,
      forceRefresh: true,
    })
    sourceResponses.set(apiId, promise)
    return promise
  }

  async function inputFor(apiId) {
    const direct = directInputs.get(apiId)
    if (direct !== undefined) return direct
    const sourceApiId = detailSources.get(apiId)
    if (sourceApiId !== undefined) {
      const source = await sourceResponse(sourceApiId)
      const reference = source.bodyReferences.find(
        (candidate) => candidate.kind === "api_input" && candidate.bodyApiId === apiId,
      )
      if (reference !== undefined) return { [reference.inputName]: reference.inputValue }
      return officialFallbacks.get(apiId) ?? {}
    }
    if (apiId === "legal_knowledge_base.related_laws") {
      const source = await sourceResponse("law.list")
      const reference = source.bodyReferences.find(
        (candidate) => candidate.kind === "api_input" && candidate.bodyApiId === "law.detail",
      )
      return reference?.kind === "api_input" ? { documentId: reference.inputValue } : {}
    }
    return sourceInputs.get(apiId) ?? {}
  }

  const results = []
  for (const apiId of LAW_API_IDS) {
    const startedAt = Date.now()
    const response = await provider.query({
      apiId,
      ...(await inputFor(apiId)),
      limit: 1,
      forceRefresh: true,
    })
    results.push({
      apiId,
      target: getLawApiConfig(apiId).target,
      status: response.status,
      elapsedMs: Date.now() - startedAt,
      referenceCount: response.bodyReferences.length,
      error: response.errors[0],
    })
  }

  const counts = Object.fromEntries(
    ["OK", "NOT_FOUND", "SOURCE_UNAVAILABLE", "PARTIAL_RESULT"].map((status) => [
      status,
      results.filter((result) => result.status === status).length,
    ]),
  )
  const report = {
    checkedAt: new Date().toISOString(),
    officialApiCount: LAW_API_IDS.length,
    attemptedApiCount: results.length,
    counts,
    results,
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  if (results.some((result) => result.status === "SOURCE_UNAVAILABLE")) process.exitCode = 1
}
