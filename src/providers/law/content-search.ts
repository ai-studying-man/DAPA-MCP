import type { DapaSearchResult, LegalDocumentDetail, ResponseStatus } from "../../types/results.js"
import type { LawProvider, LegalDetailInput, LegalSearchInput } from "./law-provider.js"

export type LegalContentHit = {
  readonly document: DapaSearchResult
  readonly status: ResponseStatus
  readonly detail?: LegalDocumentDetail
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export type LegalContentSearchResponse = {
  readonly status: ResponseStatus
  readonly results: readonly LegalContentHit[]
  readonly errors: readonly { readonly code: string; readonly message: string }[]
}

export async function searchLegalContent(
  law: Pick<LawProvider, "search" | "getDetail">,
  input: LegalSearchInput,
): Promise<LegalContentSearchResponse> {
  const search = await law.search(input)
  if (search.status === "SOURCE_UNAVAILABLE" || search.status === "NOT_FOUND") {
    return { status: search.status, results: [], errors: search.errors }
  }

  const outcomes = await Promise.all(
    search.results.map(async (document) => {
      const detailInput: LegalDetailInput = {
        documentId: document.documentId,
        sourceType: document.sourceType,
      }
      const detail = await law.getDetail(detailInput)
      return {
        document,
        status: detail.status,
        ...(detail.detail === undefined ? {} : { detail: detail.detail }),
        errors: detail.errors,
      } satisfies LegalContentHit
    }),
  )
  const errors = outcomes.flatMap((outcome) => outcome.errors)
  const successful = outcomes.filter((outcome) => outcome.status === "OK")
  return {
    status:
      successful.length === 0 ? "SOURCE_UNAVAILABLE" : errors.length > 0 ? "PARTIAL_RESULT" : "OK",
    results: outcomes,
    errors,
  }
}
