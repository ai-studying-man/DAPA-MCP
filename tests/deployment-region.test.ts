import { readFileSync } from "node:fs"
import { expect, it } from "vitest"
import { z } from "zod"

it("configures one Seoul function region for the Korean official upstream", () => {
  // Given
  const config = JSON.parse(readFileSync("vercel.json", "utf8"))
  // When
  const parsed = z.object({ regions: z.array(z.string()).optional() }).parse(config)
  // Then
  expect(parsed.regions).toEqual(["icn1"])
})
