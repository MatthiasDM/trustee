import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { Pdf, money } from "../src/worker/lib/pdf";

describe("PDF-generator", () => {
  it("maakt een geldige PDF met tabellen en pagina-einden", async () => {
    const pdf = await Pdf.create("Test VME");
    pdf.title("Jaarrekening 2026"); pdf.h2("Resultaten");
    pdf.table([{ label: "Rekening", w: 0.2 }, { label: "Omschrijving", w: 0.55 }, { label: "Bedrag", w: 0.25, align: "right" }], Array.from({ length: 80 }, (_, i) => [`61${i}`, `Kost nummer ${i} met een wat langere omschrijving die moet afbreken op de kolombreedte`, money(i * 12.5)]));
    pdf.text("Speciale tekens: € ≥ — … “ok”");
    const bytes = await pdf.bytes();
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(1);
  });
  it("formatteert bedragen in het Nederlands", () => { expect(money(1234.5)).toMatch(/1\.234,50 EUR/); });
});
