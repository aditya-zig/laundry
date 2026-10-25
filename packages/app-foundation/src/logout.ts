import type { LogoutReport } from "./session.js";

/** Never turn a failed secure-store clear or an unknown revocation into success copy. */
export function logoutNotice(report: LogoutReport): string {
  if (!report.localCredsCleared) return "Private views were cleared, but saved credentials or pending commands could not be erased. Do not consider this device fully signed out.";
  if (!report.serverRevocationConfirmed) return "Signed out locally. Server revocation was not confirmed; the server session may still be active.";
  return "Signed out on this device and the server.";
}
