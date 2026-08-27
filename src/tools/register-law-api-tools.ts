import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import {
  getLawApiBodyApiId,
  getLawApiBodyReferenceFields,
  getLawApiBodyReferenceInput,
  LAW_API_CATEGORY_IDS,
  LAW_API_IDS,
  listLawApiCategories,
} from "../providers/law/law-api-catalog.js"
import type { LawApiProvider } from "../providers/law/law-api-provider.js"
import { stringifyBoundedToolResponse } from "./law-api-tool-response.js"

const QueryLegalApiSchema = {
  apiId: z.enum(LAW_API_IDS),
  query: z.string().min(1).optional(),
  documentId: z.string().min(1).optional(),
  customCode: z.string().min(1).optional().describe("맞춤형서비스 vcode"),
  articleNumber: z
    .string()
    .regex(/^\d{6}$/)
    .optional()
    .describe("조번호 4자리와 가지번호 2자리"),
  limit: z.number().int().min(1).max(100).default(20),
  page: z.number().int().min(1).default(1),
  forceRefresh: z
    .boolean()
    .default(false)
    .describe("캐시를 사용하지 않고 API에서 다시 조회합니다."),
}

const GetLegalApiBodySchema = {
  ...QueryLegalApiSchema,
  attachmentUrl: z.string().min(1).optional().describe("별표·서식 목록 응답의 공식 파일/PDF 링크"),
}

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const

export function registerLawApiTools(
  server: McpServer,
  provider: LawApiProvider,
  maxResponseChars = 250_000,
): void {
  server.registerTool(
    "list_legal_apis",
    {
      description:
        "국가법령정보 공동활용의 DAPA 관련 14개 범주와 목록·본문 API target을 조회합니다.",
      inputSchema: { category: z.enum(LAW_API_CATEGORY_IDS).optional() },
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async ({ category }) => ({
      content: [
        {
          type: "text",
          text: stringifyBoundedToolResponse(
            {
              source: "국가법령정보 공동활용 OPEN API 활용가이드",
              guideUrl: "https://open.law.go.kr/LSO/openApi/guideList.do",
              categories: listLawApiCategories(category).map((item) => ({
                ...item,
                apis: item.apis.map((api) => ({
                  ...api,
                  bodyTool: "get_legal_api_body",
                  bodyReferenceFields: getLawApiBodyReferenceFields(api.id),
                  bodyReferenceInput: getLawApiBodyReferenceInput(api.id),
                  ...(getLawApiBodyApiId(api.id) === undefined
                    ? {}
                    : { bodyApiId: getLawApiBodyApiId(api.id) }),
                })),
              })),
            },
            maxResponseChars,
          ),
        },
      ],
    }),
  )

  server.registerTool(
    "query_legal_api",
    {
      description:
        "list_legal_apis의 apiId로 공식 목록·본문을 온디맨드 조회합니다. 콘텐츠를 MCP에 사전 적재하지 않습니다.",
      inputSchema: QueryLegalApiSchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      const response = await provider.query({
        apiId: input.apiId,
        limit: input.limit,
        page: input.page,
        forceRefresh: input.forceRefresh,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.documentId === undefined ? {} : { documentId: input.documentId }),
        ...(input.customCode === undefined ? {} : { customCode: input.customCode }),
        ...(input.articleNumber === undefined ? {} : { articleNumber: input.articleNumber }),
      })
      return {
        content: [{ type: "text", text: stringifyBoundedToolResponse(response, maxResponseChars) }],
        isError: response.status === "SOURCE_UNAVAILABLE",
      }
    },
  )

  server.registerTool(
    "get_legal_api_body",
    {
      description:
        "목록 apiId와 결과 식별자로 대응 본문 API를 자동 호출합니다. 별표·서식은 목록의 공식 파일 링크를 내려받아 HWP/HWPX/PDF/XLSX/DOCX 본문을 텍스트로 추출합니다.",
      inputSchema: GetLegalApiBodySchema,
      annotations: READ_ONLY_ANNOTATIONS,
    },
    async (input) => {
      const response = await provider.resolveBody({
        apiId: input.apiId,
        limit: input.limit,
        page: input.page,
        forceRefresh: input.forceRefresh,
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.documentId === undefined ? {} : { documentId: input.documentId }),
        ...(input.customCode === undefined ? {} : { customCode: input.customCode }),
        ...(input.articleNumber === undefined ? {} : { articleNumber: input.articleNumber }),
        ...(input.attachmentUrl === undefined ? {} : { attachmentUrl: input.attachmentUrl }),
      })
      return {
        content: [{ type: "text", text: stringifyBoundedToolResponse(response, maxResponseChars) }],
        isError: response.status === "SOURCE_UNAVAILABLE",
      }
    },
  )
}
