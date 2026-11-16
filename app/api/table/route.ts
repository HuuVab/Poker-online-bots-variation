import { env } from "cloudflare:workers";
import { handleTable } from "../../../lib/table-api.mjs";
import { getChatGPTUser } from "../../chatgpt-auth";
export async function POST(request: Request) {
 const bindings=env as unknown as {DB:D1Database;CLUB_OWNER_EMAIL?:string};
 return handleTable(request,bindings.DB,await getChatGPTUser(),{ownerEmail:bindings.CLUB_OWNER_EMAIL || (import.meta.env.DEV ? "seedy@sites.test" : undefined)});
}
