import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js"
import { afterEach, expect, it } from "vitest"
import { z } from "zod"
import { createDapaServer } from "../src/server/create-server.js"
import { startFakeLawApi } from "./helpers/fake-law-api.js"

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((close) => close()))
})

it("returns current regulation and historical judgment for a natural-language case question", async () => {
  // Given
  const api = await startFakeLawApi((request, response) => {
    const url = new URL(request.url ?? "/", "http://localhost")
    const target = url.searchParams.get("target")
    const list = url.pathname === "/lawSearch.do"
    const data =
      target === "prec"
        ? list
          ? {
              PrecSearch: {
                totalCnt: "1",
                prec: [
                  {
                    판례일련번호: "case",
                    사건명: "입찰참가자격제한처분취소",
                    사건번호: "2024두32393",
                    선고일자: "20240627",
                    법원명: "대법원",
                  },
                ],
              },
            }
          : {
              PrecService: {
                사건명: "입찰참가자격제한처분취소",
                사건번호: "2024두32393",
                선고일자: "20240627",
                판시사항: "방위사업청 납품 품질 미달과 입찰참가자격제한",
                판례내용: "방위사업청장의 입찰참가자격제한 처분에서 부정한 제조 여부를 판단한다.",
              },
            }
        : target === "admrul"
          ? { AdmRulSearch: { totalCnt: "0", admrul: [] } }
          : list
            ? {
                LawSearch: {
                  totalCnt: "1",
                  law: [
                    {
                      법령일련번호: "statute",
                      법령명한글: "방위사업법",
                      법령ID: "001",
                      시행일자: "20200101",
                      현행연혁코드: "현행",
                    },
                  ],
                },
              }
            : {
                법령: {
                  기본정보: { 법령명_한글: "방위사업법", 법령ID: "001", 시행일자: "20200101" },
                  조문: {
                    조문단위: [
                      { 조문번호: "1", 조문내용: "납품 품질 미달과 입찰참가자격제한의 적용 기준" },
                    ],
                  },
                },
              }
    response.end(JSON.stringify(data))
  })
  const root = resolve("DAPA_info")
  const server = await createDapaServer({
    dapaInfoPath: root,
    dapaCatalogPath: resolve(root, "legal/catalog.json"),
    dapaPolicyPath: resolve(root, "policy/catalog.json"),
    law: { apiKey: "test", baseUrl: api.baseUrl, retryLimit: 0 },
    legalContentSearchBudgetMs: 5000,
    maxLawApiToolResponseChars: 250000,
  })
  const client = new Client({ name: "parallel-case-e2e", version: "1.0.0" })
  const [s, c] = InMemoryTransport.createLinkedPair()
  await server.connect(s)
  await client.connect(c)
  cleanups.push(async () => {
    await client.close()
    await server.close()
    await api.close()
  })
  // When
  const result = CallToolResultSchema.parse(
    await client.callTool({
      name: "search_legal_content",
      arguments: { query: "납품 품질 미달로 제재한 사례가 있어?" },
    }),
  )
  const text = result.content.find((item) => item.type === "text")
  if (text?.type !== "text") throw new Error("missing MCP payload")
  const parsed = z
    .object({
      results: z.array(
        z.object({
          match: z.string(),
          document: z.object({
            sourceType: z.string(),
            date: z.string().optional(),
            summary: z.string().optional(),
          }),
        }),
      ),
    })
    .parse(JSON.parse(text.text))
  // Then
  expect(
    parsed.results.some((hit) => hit.document.sourceType === "law" && hit.match === "content"),
  ).toBe(true)
  expect(parsed.results.find((hit) => hit.document.sourceType === "precedent")).toMatchObject({
    match: "content",
    document: { date: "2024-06-27", summary: "2024두32393" },
  })
})
