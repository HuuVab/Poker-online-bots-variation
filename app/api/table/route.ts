import { env } from "cloudflare:workers";
import { handleTable } from "../../../lib/table-api.mjs";

export async function POST(request: Request) {
  return handleTable(request, (env as unknown as { DB: D1Database }).DB);
}
