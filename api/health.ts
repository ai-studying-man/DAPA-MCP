export function GET(): Response {
  return Response.json(
    { status: "ok", service: "dapa-mcp", transport: "streamable-http" },
    { headers: { "Cache-Control": "no-store" } },
  )
}
