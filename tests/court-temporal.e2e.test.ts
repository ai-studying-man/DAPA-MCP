import { resolve } from "node:path"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { expect, it } from "vitest"
import { z } from "zod"
import { createDapaServer } from "../src/server/create-server.js"
import { startFakeLawApi } from "./helpers/fake-law-api.js"

it("rejects unsupported historical-date queries before fetching a court original", async () => {
  // Given
  let requests = 0
  const api = await startFakeLawApi((_request, response) => {
    requests++
    response.end("<html>empty</html>")
  })
  const root = resolve("DAPA_info")
  const server = await createDapaServer({
    dapaInfoPath: root,
    dapaCatalogPath: resolve(root, "legal/catalog.json"),
    dapaPolicyPath: resolve(root, "policy/catalog.json"),
    law: {},
    officialCourt: { baseUrl: api.baseUrl, fileBaseUrl: api.baseUrl },
    maxLawApiToolResponseChars: 250_000,
    legalContentSearchBudgetMs: 5_000,
  })
  const client = new Client({ name: "court-date-test", version: "1" })
  const [s, c] = InMemoryTransport.createLinkedPair()
  await server.connect(s)
  await client.connect(c)
  try {
    // When
    const result = await client.callTool({
      name: "get_legal_detail",
      arguments: {
        sourceType: "precedent",
        documentId: "court:2:123:file.pdf",
        asOfDate: "2020-01-01",
      },
    })
    const blocks = z
      .array(z.object({ type: z.string(), text: z.string().optional() }))
      .parse(result.content)
    const payload = z
      .object({ errors: z.array(z.object({ code: z.string() })) })
      .parse(JSON.parse(blocks[0]?.text ?? "{}"))
    // Then
    expect(payload.errors[0]?.code).toBe("INVALID_ARGUMENT")
    expect(requests).toBe(0)
  } finally {
    await client.close()
    await server.close()
    await api.close()
  }
})
