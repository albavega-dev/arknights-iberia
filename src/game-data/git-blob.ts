import { createHash } from "node:crypto";

/**
 * Object id that Git gives a file (SHA-1 of "blob <size>\0" followed by the bytes). GitHub reports it in its trees and
 * listings, so a download can be checked against the exact file of a commit. It identifies content; it is not a security
 * control, and the pinned tables are also checked against their SHA-256.
 */
export function gitBlobSha(data: Buffer): string {
  return createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${data.length}\0`), data])).digest("hex");
}
