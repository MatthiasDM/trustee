import { beforeAll, describe, expect, it } from "vitest";
import { B, Client, as } from "./client";

/** Rechtenmatrix: elke rol tegen de gevoelige eindpunten. Verwacht: 2xx (toegestaan), 403 (geweigerd) of 401 (anoniem). */
const CASES: [string, string, unknown, Record<string, number[]>][] = [
  ["GET", `/api/buildings/${B}`, undefined, { syndicus: [200], raad: [200], eigenaar: [200], huurder: [200], anon: [401] }],
  ["PATCH", `/api/buildings/${B}`, { name: "Residentie Zeezicht" }, { syndicus: [200], raad: [403], eigenaar: [403], huurder: [403] }],
  ["GET", `/api/buildings/${B}/members`, undefined, { syndicus: [200], raad: [200], eigenaar: [200], huurder: [200] }],
  ["POST", `/api/buildings/${B}/invites`, { invites: [] }, { syndicus: [400], raad: [403], eigenaar: [403], huurder: [403] }],
  ["GET", `/api/buildings/${B}/audit`, undefined, { syndicus: [200], raad: [200], eigenaar: [403], huurder: [403] }],
  ["POST", `/api/buildings/${B}/broadcast`, { title: "Testbericht", body: "Inhoud" }, { syndicus: [200], raad: [403], eigenaar: [403] }],
  ["POST", `/api/buildings/${B}/folders`, { name: "Test" }, { syndicus: [201], raad: [201], eigenaar: [403], huurder: [403] }],
  ["POST", `/api/buildings/${B}/posts`, { type: "announcement", title: "Test mededeling", body: "x" }, { syndicus: [201], raad: [201], eigenaar: [403], huurder: [403] }],
  ["POST", `/api/buildings/${B}/posts`, { type: "question", title: "Test vraag", body: "x" }, { syndicus: [201], raad: [201], eigenaar: [201], huurder: [201] }],
  ["POST", `/api/buildings/${B}/polls`, { title: "Test", options: ["a", "b"] }, { syndicus: [201], raad: [201], eigenaar: [403], huurder: [403] }],
  ["POST", `/api/buildings/${B}/meetings`, { title: "Testvergadering", starts_at: "2027-01-01T18:00:00.000Z", notify: false }, { syndicus: [201], raad: [201], eigenaar: [403], huurder: [403] }],
  ["POST", `/api/buildings/${B}/agenda`, { title: "Testpunt" }, { syndicus: [201], raad: [201], eigenaar: [201], huurder: [403] }],
  ["POST", `/api/buildings/${B}/mandates`, { organ: "commissaris", holder_name: "X", start_date: "2026-01-01", end_date: "2026-12-31" }, { syndicus: [201], raad: [201], eigenaar: [403], huurder: [403] }],
  ["POST", `/api/buildings/${B}/ledger/entries`, { date: "2026-05-05", description: "Testpost", lines: [{ account_code: "6121", debit: 1 }, { account_code: "440", credit: 1 }] }, { syndicus: [201], raad: [403], eigenaar: [403], huurder: [403] }],
  ["GET", `/api/buildings/${B}/ledger/entries?fy=fy-2026`, undefined, { syndicus: [200], raad: [200], eigenaar: [200], huurder: [200] }],
  ["GET", `/api/buildings/${B}/ledger/overdue`, undefined, { syndicus: [200], raad: [200], eigenaar: [403], huurder: [403] }],
  ["POST", `/api/buildings/${B}/ledger/calls`, { fund: "working", date: "2026-05-01", description: "Testoproep", total: 1 }, { syndicus: [201], raad: [403], eigenaar: [403] }],
  ["GET", `/api/buildings/${B}/ledger/recurring`, undefined, { syndicus: [200], raad: [200], eigenaar: [403] }],
  ["POST", `/api/buildings/${B}/suppliers`, { name: "Testleverancier" }, { syndicus: [201], raad: [403], eigenaar: [403] }],
  ["POST", `/api/buildings/${B}/compliance`, { kind: "brand", title: "Testkeuring", interval_months: 12, next_date: "2027-01-01" }, { syndicus: [201], raad: [201], eigenaar: [403] }],
  ["GET", `/api/buildings/${B}/export`, undefined, { syndicus: [200], raad: [200], eigenaar: [403], huurder: [403] }],
  ["GET", `/api/orgs/org-demo/overview`, undefined, { syndicus: [200], raad: [403], eigenaar: [403] }],
  ["GET", `/api/buildings/b-onbekend`, undefined, { syndicus: [404], eigenaar: [404] }],
];
const USERS: Record<string, string> = { syndicus: "syndicus", raad: "jan", eigenaar: "marie", huurder: "lotte" };

describe("Rechtenmatrix per rol", () => {
  const clients: Record<string, Client> = {};
  beforeAll(async () => { for (const [role, u] of Object.entries(USERS)) clients[role] = await as(u); clients.anon = new Client("anon"); });
  for (const [method, path, body, expected] of CASES) for (const [role, codes] of Object.entries(expected)) {
    it(`${role}: ${method} ${path.replace(`/api/buildings/${B}`, "")} → ${codes.join("/")}`, async () => {
      const r = await clients[role].json(method, path, body);
      expect(codes, `${role} kreeg ${r.status}: ${JSON.stringify(r.data).slice(0, 120)}`).toContain(r.status);
    });
  }
  it("mede-eigenaar ziet enkel documenten van eigen kavel; raad en commissaris zien alles", async () => {
    const synd = clients.syndicus;
    const made = await synd.post(`/api/buildings/${B}/ledger/statements/fy-2026/send`, { notify: false }); expect(made.status).toBe(201);
    const marie = await clients.eigenaar.get(`/api/buildings/${B}/documents?q=Afrekening 2026`); const labels = marie.data.map((d: any) => d.unit_label).filter(Boolean);
    expect(labels.every((l: string) => ["A2", "G2"].includes(l))).toBe(true); expect(labels.length).toBeGreaterThan(0);
    const a1 = made.data.statements.find((s: any) => s.label === "A1").document_id;
    expect((await clients.eigenaar.raw("GET", `/api/buildings/${B}/documents/${a1}/download`)).status).toBe(404);
    expect((await clients.raad.raw("GET", `/api/buildings/${B}/documents/${a1}/download`)).status).toBe(200);
    expect((await clients.huurder.get(`/api/buildings/${B}/documents?q=Afrekening 2026`)).data).toHaveLength(0);
  });
  it("privé-vraag aan de syndicus is onzichtbaar voor andere leden", async () => {
    const r = await clients.eigenaar.post(`/api/buildings/${B}/posts`, { type: "question", title: "Privé vraag over mijn achterstal", body: "x", visibility: "syndicus" });
    expect((await clients.raad.get(`/api/buildings/${B}/posts/${r.data.id}`)).status).toBe(404);
    expect((await clients.syndicus.get(`/api/buildings/${B}/posts/${r.data.id}`)).status).toBe(200);
    expect((await clients.eigenaar.get(`/api/buildings/${B}/posts/${r.data.id}`)).status).toBe(200);
  });
});

describe("Regressie: PATCH mag velden met standaardwaarde niet resetten", () => {
  it("gebouwinstelling wijzigen laat het totaal aandelen en de naam ongemoeid", async () => {
    const s = await as("syndicus");
    const before = (await s.get(`/api/buildings/${B}`)).data;
    expect((await s.patch(`/api/buildings/${B}`, { reminder_days_1: 9 })).status).toBe(200);
    const after = (await s.get(`/api/buildings/${B}`)).data;
    expect(after.total_shares).toBe(before.total_shares); expect(after.name).toBe(before.name); expect(after.reminder_days_1).toBe(9);
  });
  it("kavel hernoemen behoudt aandelen en type; agenderen behoudt de vereiste meerderheid; vergaderingstype blijft", async () => {
    const s = await as("syndicus"); const m = await as("marie");
    const u = (await s.get(`/api/buildings/${B}/units`)).data.units.find((x: any) => x.label === "G1");
    await s.patch(`/api/buildings/${B}/units/${u.id}`, { label: "G1" });
    const u2 = (await s.get(`/api/buildings/${B}/units`)).data.units.find((x: any) => x.id === u.id); expect(u2.shares).toBe(u.shares); expect(u2.type).toBe("garage");
    const it = (await m.post(`/api/buildings/${B}/agenda`, { title: "Regressie meerderheid", required_majority: "four_fifths" })).data.id;
    const mt = (await s.post(`/api/buildings/${B}/meetings`, { title: "Regressie BAV", type: "bav", starts_at: "2027-03-01T18:00:00.000Z", notify: false })).data.id;
    await s.patch(`/api/buildings/${B}/agenda/${it}`, { meeting_id: mt });
    expect((await s.get(`/api/buildings/${B}/agenda?meeting=${mt}`)).data.items[0].required_majority).toBe("four_fifths");
    await s.patch(`/api/buildings/${B}/meetings/${mt}`, { location: "Elders", notify: false });
    expect((await s.get(`/api/buildings/${B}/meetings`)).data.find((x: any) => x.id === mt).type).toBe("bav");
  });
});
