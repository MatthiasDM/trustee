import { describe, expect, it } from "vitest";
import { addMonths, decisionTerms } from "../src/worker/lib/decisions";

describe("Termijnen beslissingenregister", () => {
  it("telt 4 maanden af, ook aan het einde van een maand", () => {
    expect(addMonths("2026-03-15", 4)).toBe("2026-07-15");
    expect(addMonths("2026-10-31", 4)).toBe("2027-02-28");
    expect(addMonths("2027-11-30", 3)).toBe("2028-02-29");
  });
  it("aanvechtbaar binnen 4 maanden, daarna definitief; notulen binnen 30 dagen", () => {
    const base = { decided_on: "2026-03-15", kind: "general", adopted: 1, unanimous: false, challenge_status: null, court_status: null };
    expect(decisionTerms(base, "2026-07-15").status).toBe("challengeable");
    expect(decisionTerms(base, "2026-07-16").status).toBe("final");
    expect(decisionTerms({ ...base, minutes_sent_at: "2026-04-10T10:00:00Z" }, "2026-05-01").minutes_late).toBe(false);
    expect(decisionTerms({ ...base, minutes_sent_at: "2026-04-20T10:00:00Z" }, "2026-05-01").minutes_late).toBe(true);
    expect(decisionTerms({ ...base, challenge_status: "pending" }, "2026-09-01").status).toBe("challenged");
    expect(decisionTerms({ ...base, challenge_status: "annulled" }, "2026-09-01").status).toBe("annulled");
  });
  it("afbraak en heropbouw zonder eenparigheid: geschorst tot vonnis; eenparig: niet", () => {
    const d = { decided_on: "2026-03-15", kind: "demolition", adopted: 1, unanimous: false, challenge_status: null, court_status: null };
    const t = decisionTerms(d, "2026-04-01"); expect(t.needs_court).toBe(true); expect(t.execution_suspended).toBe(true); expect(t.court_until).toBe("2026-07-15");
    expect(decisionTerms({ ...d, court_status: "approved" }, "2026-09-01").status).toBe("final");
    expect(decisionTerms({ ...d, unanimous: true }, "2026-04-01").needs_court).toBe(false);
  });
  it("verworpen werken: verwijzing naar art. 3.92 §5", () => {
    expect(decisionTerms({ decided_on: "2026-03-15", kind: "works", adopted: 0, unanimous: false, challenge_status: null, court_status: null }).hints.join(" ")).toMatch(/3\.92 §5/);
  });
});
