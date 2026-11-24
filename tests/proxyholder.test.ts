import { describe, expect, it } from "vitest";
import { holderMayAccess, normName } from "../src/worker/lib/proxyholder";

const P = "/api/buildings/b1"; const mine = ["m1"]; const q = (v: Record<string, string> = {}) => (k: string) => v[k];
const ok = (method: string, path: string, query: Record<string, string> = {}) => holderMayAccess(method, P + path, q(query), mine);

describe("Toegang van een volmachtdrager van buiten het gebouw", () => {
  it("mag zijn vergadering zien, vanop afstand deelnemen, stemmen en tekenen", () => {
    for (const [m, p] of [["GET", "/meetings"], ["GET", "/meetings/m1/attendance"], ["GET", "/meetings/m1/remote"], ["GET", "/meetings/m1/ics"], ["GET", "/meetings/m1/minutes/signatures"], ["PUT", "/meetings/m1/rsvp"], ["PUT", "/meetings/m1/agenda/a1/ballot"], ["POST", "/meetings/m1/minutes/sign"], ["DELETE", "/meetings/m1/minutes/signatures/u1"]])
      expect(ok(m, p), `${m} ${p}`).toBe(true);
    expect(ok("GET", "/agenda", { meeting: "m1" })).toBe(true);
  });
  it("mag niets anders: geen andere vergadering, geen beheer, geen andere onderdelen van het gebouw", () => {
    for (const [m, p] of [["GET", ""], ["GET", "/documents"], ["GET", "/members"], ["GET", "/posts"], ["GET", "/ledger/overview"], ["GET", "/agenda"], ["GET", "/meetings/m2/attendance"], ["GET", "/meetings/m2/remote"], ["PUT", "/meetings/m2/rsvp"],
      ["GET", "/meetings/m1/rsvps"], ["GET", "/meetings/m1/convene"], ["POST", "/meetings/m1/convene"], ["PATCH", "/meetings/m1"], ["DELETE", "/meetings/m1"], ["POST", "/meetings"], ["POST", "/meetings/m1/minutes/finalize"], ["PATCH", "/meetings/m1/minutes"],
      ["POST", "/meetings/m1/minutes/signatures/paper"], ["POST", "/meetings/m1/agenda/a1/vote"], ["POST", "/meetings/m1/agenda/a1/ballot/open"], ["GET", "/meetings/m1/registered/letters.pdf"], ["POST", "/agenda"], ["GET", "/meetings/m1/../documents"], ["GET", "/meetings/m1"]])
      expect(ok(m, p), `${m} ${p}`).toBe(false);
    expect(ok("GET", "/agenda", { meeting: "m2" })).toBe(false);
    expect(holderMayAccess("GET", P + "/meetings/m1/remote", q(), [])).toBe(false);
  });
  it("herkent dezelfde naam ongeacht hoofdletters, accenten en spaties", () => {
    expect(normName("  Méester  AN de-Wolf ")).toBe(normName("meester an de wolf"));
    expect(normName("An De Wolf")).not.toBe(normName("Ann De Wolf"));
  });
});
