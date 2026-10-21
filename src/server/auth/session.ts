import "server-only";

import { headers } from "next/headers";
import { getAuth } from "./auth";
import { requireSession } from "./session-policy";

export async function getCurrentSession(requestHeaders?: Headers) {
  return getAuth().api.getSession({ headers: requestHeaders ?? await headers() });
}

// Call at each private data boundary; never rely on page visibility or cookie presence alone.
export async function requireCurrentSession(requestHeaders?: Headers) {
  return requireSession(() => getCurrentSession(requestHeaders));
}
