import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import { searchLegalContent } from "../providers/law/content-search.js"
import type { LawProvider } from "../providers/law/law-provider.js"
import { READ_ONLY_ANNOTATIONS, textResult } from "./tool-response.js"

const LEGAL_SOURCE_TYPES = ["law", "administrative_rule"] as const

const SearchLegalContentSchema = {
  query: z.string().min(1).describe("본문에서 찾을 법률·업무 내용 또는 법령명"),
  types: z.array(z.enum(LEGAL_SOURCE_TYPES)).max(2).default(["law", "administrative_rule"]),
  currentOnly: z.boolean().default(true),
  forceRefresh: z.boolean().default(false),
  asOfDate: z.iso.date().optional(),
  limit: z.number().int().min(1).max(10).default(5),
}

export function registerLegalContentTools(server: McpServer, law: LawProvider): void {
  server.registerTool(
    "search_legal_content",
    {
      title: "법령·행정규칙 본문 검색",
      description:
        "국가법령정보 API에서 후보 문서를 검색하고 각 문서의 최신 상세 본문과 조문을 함께 조회합니다.",
      inputSchema: SearchLegalContentSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      textResult(
        await searchLegalContent(law, {
          query: input.query,
          types: input.types,
          currentOnly: input.currentOnly,
          forceRefresh: input.forceRefresh,
          limit: input.limit,
          ...(input.asOfDate === undefined ? {} : { asOfDate: input.asOfDate }),
        }),
      ),
  )
}
