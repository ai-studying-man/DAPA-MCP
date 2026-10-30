import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"

const endpoint = process.env.DAPA_MCP_URL ?? "https://dapa-law-mcp.vercel.app/law"
const output = resolve(process.env.DAPA_QA_OUTPUT ?? ".qa-results")
const client = new Client({ name: "dapa-employee-quality-check", version: "1.0.0" })
const questions = [
  {
    id: 1,
    type: "law",
    query: "방위사업법 제3조에서 방위력개선사업의 뜻을 설명해줘",
    terms: ["방위력개선사업", "구매", "연구개발"],
  },
  {
    id: 2,
    type: "law",
    automaticTypes: true,
    query: "방위사업법에서 방위력개선사업과 군수품 조달은 어떤 차이가 있나요?",
    terms: ["방위력개선사업", "군수품"],
  },
  {
    id: 3,
    type: "administrative_rule",
    query: "사업추진기본전략은 무엇이며 어떤 내용을 포함해야 하나요?",
    terms: ["사업추진기본전략"],
  },
  {
    id: 4,
    type: "administrative_rule",
    automaticTypes: true,
    query: "선행연구와 사업타당성조사는 어떻게 다른가요?",
    terms: ["선행연구", "사업타당성조사"],
  },
  {
    id: 5,
    type: "precedent",
    query: "방산물자 납품계약에서 지체상금이 문제 된 판례 사례를 알려줘",
    terms: ["지체상금"],
    defense: true,
  },
  {
    id: 6,
    type: "precedent",
    query: "완제품 규격이 미달하면 방위사업청이 바로 입찰참가자격을 제한할 수 있나요?",
    terms: ["부정", "제조"],
    defense: true,
  },
  {
    id: 7,
    type: "local_ordinance",
    query: "경기도 방위산업 육성 및 지원에 관한 조례에서 기업에 어떤 지원을 할 수 있나요?",
    terms: ["기술개발", "지원"],
  },
  {
    id: 8,
    type: "local_ordinance",
    query: "가평군 드론산업 육성 및 지원 조례의 지원 대상과 사업을 알려줘",
    terms: ["드론", "지원"],
  },
  {
    id: 9,
    type: "constitutional_case",
    query: "군사기밀보호법과 국민의 알 권리가 충돌한 헌재 사례를 알려줘",
    terms: ["알 권리"],
  },
  {
    id: 10,
    type: "constitutional_case",
    query: "입찰참가자격 제한이 직업의 자유를 침해하는지 판단한 헌재 사례가 있나요?",
    terms: ["입찰참가", "직업", "자유"],
  },
]

function normalize(value) {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase()
}

function evidenceText(hit) {
  return [
    ...(hit.detail?.articles ?? []).map((article) => article.text),
    ...(hit.excerpts ?? []),
    ...(hit.detail?.annexes ?? []).map((section) => section.text),
  ].join("\n")
}

const results = []
try {
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint)))
  const catalog = await client.listTools()
  for (const question of questions) {
    const started = performance.now()
    try {
      const tool = await client.callTool(
        {
          name: "search_legal_content",
          arguments: {
            query: question.query,
            ...(question.automaticTypes ? {} : { types: [question.type] }),
            limit: 5,
            mode: "fast",
            currentOnly: true,
            forceRefresh: process.env.DAPA_QA_FORCE_REFRESH === "1",
          },
        },
        undefined,
        { timeout: 65_000 },
      )
      const text = tool.content?.find((block) => block.type === "text")?.text
      if (typeof text !== "string") throw new Error("MCP returned no text payload")
      const payload = JSON.parse(text)
      const bodies = (payload.results ?? []).filter(
        (hit) => hit.status === "OK" && hit.match === "content",
      )
      const evidence = normalize(bodies.map(evidenceText).join("\n"))
      const missing = question.terms.filter((term) => !evidence.includes(normalize(term)))
      const defenseContext =
        !question.defense ||
        bodies.some(
          (hit) =>
            hit.caseRelevance === "defense_context" ||
            /방위사업청|방산물자|군수품/u.test(evidenceText(hit)),
        )
      const verdict =
        bodies.length === 0
          ? "NO_VERIFIED_BODY"
          : missing.length > 0
            ? "PARTIAL_EVIDENCE"
            : !defenseContext
              ? "GENERAL_CASE_ONLY"
              : payload.answerEvidence?.decision !== "grounded"
                ? "PARTIAL_EVIDENCE"
                : question.defense
                  ? "CONTEXT_ONLY_REQUIRES_REVIEW"
                  : "BODY_CONFIRMED"
      const result = {
        ...question,
        elapsedMs: Math.round(performance.now() - started),
        verdict,
        missing,
        answerEvidence: payload.answerEvidence ?? null,
        status: payload.status,
        evidence: bodies.map((hit) => ({
          title: hit.document.title,
          documentId: hit.document.documentId,
          sourceUrl: hit.document.sourceUrl,
          effectiveDate: hit.document.effectiveDate,
          caseRelevance: hit.caseRelevance,
          articles: hit.detail?.articles,
          excerpts: hit.excerpts,
          coverage: hit.evidenceCoverage,
        })),
        errors: payload.errors,
        payload,
      }
      results.push(result)
      process.stdout.write(
        `${JSON.stringify({
          id: result.id,
          verdict,
          ms: result.elapsedMs,
          missing,
          titles: result.evidence.map((item) => item.title),
        })}\n`,
      )
    } catch (error) {
      if (!(error instanceof Error)) throw error
      const result = {
        ...question,
        elapsedMs: Math.round(performance.now() - started),
        verdict: "CALL_FAILED",
        error: error.message,
      }
      results.push(result)
      process.stdout.write(`${JSON.stringify(result)}\n`)
    }
  }
  const times = results.map((result) => result.elapsedMs).sort((a, b) => a - b)
  const report = {
    testedAt: new Date().toISOString(),
    endpoint,
    sourceCommit: process.env.DAPA_QA_COMMIT ?? null,
    measurement:
      "MCP retrieval only; no LLM generation or independent legal conclusion verification",
    toolNames: catalog.tools.map((tool) => tool.name),
    summary: {
      total: results.length,
      bodyConfirmed: results.filter((result) => result.verdict === "BODY_CONFIRMED").length,
      averageMs: Math.round(times.reduce((sum, time) => sum + time, 0) / times.length),
      medianMs: Math.round(((times[4] ?? 0) + (times[5] ?? 0)) / 2),
      maxMs: times.at(-1),
    },
    results,
  }
  await mkdir(output, { recursive: true })
  await writeFile(
    resolve(output, "employee-questions.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({
      summary: report.summary,
      report: resolve(output, "employee-questions.json"),
    })}\n`,
  )
} finally {
  await client.close()
}
