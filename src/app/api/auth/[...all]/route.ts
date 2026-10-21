import { toNextJsHandler } from "better-auth/next-js";
import { connection } from "next/server";
import { getAuth } from "@/server/auth/auth";
import { authenticationDisabledResponse, isPublicAuthenticationEnabled } from "@/server/auth/beta-access-policy";

// Keep construction lazy so build never needs a secret or opens a DB connection.
async function handle(request: Request) {
  await connection();
  if (!isPublicAuthenticationEnabled(process.env)) return authenticationDisabledResponse();
  try {
    return await toNextJsHandler(getAuth()).GET(request);
  } catch {
    return Response.json({ error: "Authentication unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

async function handlePost(request: Request) {
  await connection();
  if (!isPublicAuthenticationEnabled(process.env)) return authenticationDisabledResponse();
  try {
    return await toNextJsHandler(getAuth()).POST(request);
  } catch {
    return Response.json({ error: "Authentication unavailable" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}

export { handle as GET, handlePost as POST };
