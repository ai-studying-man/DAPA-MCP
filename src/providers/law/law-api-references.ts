import { z } from "zod"
import {
  getLawApiBodyApiId,
  getLawApiBodyReferenceFields,
  getLawApiBodyReferenceInput,
  type LawApiConfig,
  type LawApiId,
} from "./law-api-catalog.js"

const ApiRecordSchema = z.record(z.string(), z.unknown())

export type LawApiBodyReference =
  | {
      readonly kind: "api_input"
      readonly bodyApiId: LawApiId
      readonly inputName: "query" | "documentId"
      readonly inputValue: string
      readonly sourceField: string
    }
  | {
      readonly kind: "attachment"
      readonly attachmentUrl: string
      readonly attachmentField: string
    }

export function extractLawApiBodyReferences(
  api: LawApiConfig,
  data: Readonly<Record<string, unknown>>,
): readonly LawApiBodyReference[] {
  const fields = getLawApiBodyReferenceFields(api.id)
  if (fields.length === 0) return []
  const bodyApiId = getLawApiBodyApiId(api.id)
  const inputName = getLawApiBodyReferenceInput(api.id)
  const references: LawApiBodyReference[] = []
  const seen = new Set<string>()

  visitObjects(data, (record) => {
    for (const field of fields) {
      const value = record[field]
      if (typeof value !== "string" && typeof value !== "number") continue
      const normalized = String(value).trim()
      if (normalized.length === 0) continue
      if (api.bodyResolution === "download_link") {
        const key = `attachment:${normalized}`
        if (seen.has(key)) continue
        seen.add(key)
        references.push({
          kind: "attachment",
          attachmentUrl: normalized,
          attachmentField: field,
        })
        continue
      }
      if (bodyApiId === undefined || (inputName !== "query" && inputName !== "documentId")) continue
      const key = `api_input:${bodyApiId}:${inputName}:${normalized}`
      if (seen.has(key)) continue
      seen.add(key)
      references.push({
        kind: "api_input",
        bodyApiId,
        inputName,
        inputValue: normalized,
        sourceField: field,
      })
      break
    }
  })
  return references
}

function visitObjects(
  value: unknown,
  visit: (record: Readonly<Record<string, unknown>>) => void,
): void {
  if (Array.isArray(value)) {
    for (const item of value) visitObjects(item, visit)
    return
  }
  const record = ApiRecordSchema.safeParse(value)
  if (!record.success) return
  visit(record.data)
  for (const child of Object.values(record.data)) visitObjects(child, visit)
}
