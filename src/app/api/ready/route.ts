import { checkDatabaseConnectivity } from "@/server/db/connectivity";
import { connection } from "next/server";

export async function GET() {
  await connection();
  try {
    await checkDatabaseConnectivity();
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json(
      { status: "unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
