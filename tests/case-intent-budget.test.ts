import { expect, it } from "vitest"
import { planCaseSearch } from "../src/providers/law/case-search-plan.js"

it("reserves automatic case discovery for actual case requests or mapped disputes", () => {
  // Given
  const question = "방위사업법에서 방위력개선사업과 군수품 조달은 어떤 차이가 있나요?"
  // When
  const plan = planCaseSearch(question)
  // Then
  expect(plan.searchQueries).toEqual([])
  expect(plan.legalQuery).toBe(question)
})
