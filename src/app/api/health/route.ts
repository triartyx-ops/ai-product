export function GET(): Response {
  return Response.json({ service: "github-radar-indexer", status: "ok" });
}
