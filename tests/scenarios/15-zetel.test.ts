import { describe, expect, it } from "vitest";
import { B, as } from "./client";

/** Zetel (art. 3.86 §1), ondernemingsnummer op documenten, uittreksel aanstelling syndicus aan de ingang (art. 3.89 §2). */
describe("Zetel en uittreksel aanstelling syndicus", () => {
  it("zetel en syndicusgegevens bewaren; uittreksel als PDF; aanplakking registreren; waarschuwing verdwijnt", async () => {
    const synd = await as("syndicus"); const jan = await as("jan");
    expect((await synd.patch(`/api/buildings/${B}`, { seat_address: "Zeedijk 12, 8400 Oostende", syndicus_info: { name: "Syndicus Vermeulen", legal_form: "BV", address: "Kerkstraat 1, 8400 Oostende", enterprise_number: "0123.456.789", phone: "059 12 34 56", consult_place: "Kantoor syndicus, Kerkstraat 1" } })).status).toBe(200);
    const info = (await jan.get(`/api/buildings/${B}`)).data; expect(info.seat_address).toBe("Zeedijk 12, 8400 Oostende"); expect(info.syndicus_info.legal_form).toBe("BV");
    const m = (await synd.get(`/api/buildings/${B}/mandates`)).data.mandates.find((x: any) => x.organ === "syndicus");
    const organs = (await synd.get(`/api/buildings/${B}/organs`)).data; expect(organs.warnings.join(" ")).toMatch(/uittreksel van de aanstelling.*3\.89 §2/);
    const r = await synd.post(`/api/buildings/${B}/mandates/${m.id}/extract`); expect(r.status).toBe(201);
    const pdf = await synd.raw("GET", `/api/buildings/${B}/documents/${r.data.document_id}/download`); expect(pdf.headers.get("content-type")).toMatch(/pdf/); const bytes = new Uint8Array(await pdf.arrayBuffer()); expect(String.fromCharCode(...bytes.slice(0, 5))).toBe("%PDF-");
    expect((await jan.post(`/api/buildings/${B}/mandates/${m.id}/extract`)).status).toBe(201); // raad mag ook
    expect((await synd.patch(`/api/buildings/${B}/mandates/${m.id}`, { extract_posted_at: new Date().toISOString().slice(0, 10) })).status).toBe(200);
    expect((await synd.get(`/api/buildings/${B}/organs`)).data.warnings.join(" ")).not.toMatch(/uittreksel van de aanstelling/);
    expect((await (await as("marie")).post(`/api/buildings/${B}/mandates/${m.id}/extract`)).status).toBe(403);
  });
});
