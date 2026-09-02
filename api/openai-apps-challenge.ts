const DEFAULT_CHALLENGE_TOKEN = "wEHzKs_VE1FG8r_FIkpXIJr3B_Ui_9gH6DYN68HVEWY"

export function GET(): Response {
  const token = process.env["OPENAI_APPS_CHALLENGE_TOKEN"] ?? DEFAULT_CHALLENGE_TOKEN
  return new Response(token, {
    status: 200,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
    },
  })
}
