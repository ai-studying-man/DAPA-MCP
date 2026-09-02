import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { DapaPolicyProvider } from "../providers/dapa-policy/provider.js"
import type { SearchResponse } from "../types/results.js"
import { READ_ONLY_ANNOTATIONS, textResult } from "./tool-response.js"

const SearchDapaPolicySchema = {
  query: z.string().min(1),
  section: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(50).default(10),
}

export function registerDapaPolicyTools(server: McpServer, dapaPolicy: DapaPolicyProvider): void {
  server.registerTool(
    "search_dapa_policy",
    {
      title: "방위사업청 정책자료 검색",
      description: "방위사업청 업무·정책 메뉴와 하위 탭에서 동기화한 공개 본문을 검색합니다.",
      inputSchema: SearchDapaPolicySchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) =>
      toToolResult(
        dapaPolicy.search({
          query: input.query,
          limit: input.limit,
          ...(input.section === undefined ? {} : { section: input.section }),
        }),
      ),
  )

  server.registerTool(
    "get_dapa_policy_page",
    {
      title: "방위사업청 정책자료 원문 조회",
      description: "search_dapa_policy에서 받은 ID로 업무·정책 페이지 전체 본문을 조회합니다.",
      inputSchema: { id: z.string().min(1) },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ id }) => {
      const page = dapaPolicy.get(id)
      return textResult(
        page === undefined
          ? { status: "NOT_FOUND", page: null, errors: [] }
          : { status: "OK", page, errors: [] },
      )
    },
  )
}

function toToolResult(response: SearchResponse): ReturnType<typeof textResult> {
  return textResult(response, response.status === "SOURCE_UNAVAILABLE")
}
