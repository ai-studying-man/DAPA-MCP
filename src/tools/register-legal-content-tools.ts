import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { LEGAL_CONTENT_SEARCH_MODES, searchLegalContent } from "../providers/law/content-search.js"
import type { LawProvider } from "../providers/law/law-provider.js"
import { READ_ONLY_ANNOTATIONS, textResult } from "./tool-response.js"

const LEGAL_SOURCE_TYPES = [
  "law",
  "administrative_rule",
  "local_ordinance",
  "precedent",
  "constitutional_case",
  "interpretation",
  "administrative_appeal",
] as const

const SearchLegalContentSchema = {
  query: z.string().min(1).max(500).describe("본문에서 찾을 법률·업무 내용 또는 법령명"),
  types: z
    .array(z.enum(LEGAL_SOURCE_TYPES))
    .min(1)
    .max(7)
    .optional()
    .describe(
      "생략하면 질문 문장에서 자료 유형을 판별하고, 불명확하면 법령·행정규칙을 조회합니다.",
    ),
  currentOnly: z.boolean().default(true),
  forceRefresh: z.boolean().default(false),
  mode: z
    .enum(LEGAL_CONTENT_SEARCH_MODES)
    .default("fast")
    .describe("fast는 상위 근거를 단계적으로 확인하고, thorough는 넓은 범위를 조회합니다."),
  asOfDate: z.iso.date().optional(),
  limit: z.number().int().min(1).max(10).default(5),
}

export function registerLegalContentTools(
  server: McpServer,
  law: LawProvider,
  timeBudgetMs: number,
): void {
  server.registerTool(
    "search_legal_content",
    {
      title: "법령·판례 통합 본문 검색",
      description:
        "법령·행정규칙·자치법규·판례·헌재결정례·해석례·행정심판례의 공식 본문을 검색하고 관련 조문이나 판단 근거만 반환합니다.",
      inputSchema: SearchLegalContentSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      textResult(
        await searchLegalContent(law, {
          query: input.query,
          ...(input.types === undefined ? {} : { types: input.types }),
          currentOnly: input.currentOnly,
          forceRefresh: input.forceRefresh,
          mode: input.mode,
          limit: input.limit,
          timeBudgetMs,
          ...(input.asOfDate === undefined ? {} : { asOfDate: input.asOfDate }),
        }),
      ),
  )
}
