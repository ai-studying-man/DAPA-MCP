import type { SearchResponse } from "../../types/results.js"

export type InternalSearchInput = {
  readonly query: string
  readonly limit: number
}

export interface InternalProjectProvider {
  searchProjects(input: InternalSearchInput): Promise<SearchResponse>
}

export interface InternalContractProvider {
  searchContracts(input: InternalSearchInput): Promise<SearchResponse>
}

export interface InternalProcurementProvider {
  searchProcurements(input: InternalSearchInput): Promise<SearchResponse>
}

export class DisabledInternalProvider
  implements InternalProjectProvider, InternalContractProvider, InternalProcurementProvider
{
  async searchProjects(_input: InternalSearchInput): Promise<SearchResponse> {
    return disabledResponse()
  }

  async searchContracts(_input: InternalSearchInput): Promise<SearchResponse> {
    return disabledResponse()
  }

  async searchProcurements(_input: InternalSearchInput): Promise<SearchResponse> {
    return disabledResponse()
  }
}

function disabledResponse(): SearchResponse {
  return {
    status: "SOURCE_UNAVAILABLE",
    results: [],
    errors: [
      {
        code: "PROVIDER_NOT_CONFIGURED",
        message: "내부 시스템 Provider는 공개 배포에서 비활성화되어 있습니다",
      },
    ],
  }
}
