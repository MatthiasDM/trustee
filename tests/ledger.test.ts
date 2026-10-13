import { describe, expect, it } from "vitest";
import { allocate, ogm, ogmDigits, ogmValid, parseBankCsv, parseCoda, round2 } from "../src/worker/lib/ledger";
import { KB_CHART, classOf, normalSide } from "../src/worker/lib/chart";
import { safeContentType, validateUpload } from "../src/worker/lib/files";

describe("verdeling over kavels", () => {
  it("verdeelt volgens gewichten en sluit op de cent", () => {
    const w = new Map([["a", 250], ["b", 300], ["c", 350], ["g1", 50], ["g2", 50]]);
    const out = allocate(1000, w);
    expect(round2([...out.values()].reduce((s, v) => s + v, 0))).toBe(1000);
    expect(out.get("c")).toBe(350);
  });
  it("legt het afrondingsverschil bij de grootste kavel", () => {
    const out = allocate(100, new Map([["a", 1], ["b", 1], ["c", 1]]));
    expect(round2([...out.values()].reduce((s, v) => s + v, 0))).toBe(100);
    expect(out.get("a")).toBe(33.34);
  });
  it("geeft niets terug zonder gewichten", () => { expect(allocate(100, new Map()).size).toBe(0); });
});

describe("gestructureerde mededeling", () => {
  it("berekent een geldig controlegetal (mod 97)", () => {
    const s = ogm("0010001198");
    expect(s).toMatch(/^\+\+\+\d{3}\/\d{4}\/\d{5}\+\+\+$/);
    expect(ogmValid(ogmDigits(s))).toBe(true);
  });
  it("gebruikt 97 wanneer de rest 0 is", () => { expect(ogmValid(ogmDigits(ogm("0000000097")))).toBe(true); expect(ogm("0000000097").endsWith("97+++")).toBe(true); });
  it("verwerpt een fout controlegetal", () => { expect(ogmValid("001000119814")).toBe(false); });
});

describe("rekeningenstelsel", () => {
  it("heeft unieke codes en juiste klassen", () => {
    const codes = KB_CHART.map((a) => a.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const a of KB_CHART) expect([1, 2, 4, 5, 6, 7]).toContain(classOf(a.code));
  });
  it("bevat de kernrekeningen van het CBN-voorbeeld", () => {
    for (const c of ["4100", "4101", "440", "550", "551", "693", "700", "701", "48901", "48902", "6302", "2300", "2309"]) expect(KB_CHART.some((a) => a.code === c && !a.header)).toBe(true);
  });
  it("kent de normale zijde", () => { expect(normalSide("asset")).toBe("debit"); expect(normalSide("income")).toBe("credit"); });
});

describe("CSV-import bank", () => {
  it("herkent een KBC-export met kolommen in Nederlands", () => {
    const csv = "Rekeningnummer;Rubrieknaam;Naam;Munt;Afschriftnummer;Datum;Omschrijving;Valuta;Bedrag;Saldo;credit;debet;rekeningnummer tegenpartij;BIC tegenpartij;Naam tegenpartij;Adres tegenpartij;gestructureerde mededeling;Vrije mededeling\nBE68539007547034;;VME;EUR;2026003;25/02/2026;EUROPESE OVERSCHRIJVING;25/02/2026;-1.200,00;;;;BE11222233334444;KREDBEBB;KONE BELGIUM;;;factuur lift\nBE68539007547034;;VME;EUR;2026003;26/02/2026;OVERSCHRIJVING;26/02/2026;300,00;;;;BE12345678901234;KREDBEBB;CLAES MARIE;;+++001/0002/19843+++;\n";
    const r = parseBankCsv(csv);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: "2026-02-25", amount: -1200, counterparty_name: "KONE BELGIUM", counterparty_iban: "BE11222233334444" });
    expect(r.rows[0].communication).toContain("factuur lift");
    expect(r.rows[1].structured_ref).toBe("001000219843");
    expect(r.rows[0].external_ref).not.toBe(r.rows[1].external_ref);
  });
  it("vraagt om mapping bij onbekende koppen", () => {
    const r = parseBankCsv("a,b,c\n1,2,3\n");
    expect(r.rows).toHaveLength(0);
    expect(r.headers).toEqual(["a", "b", "c"]);
  });
  it("werkt met expliciete mapping en komma-decimalen", () => {
    const r = parseBankCsv("x;y;z\n01-03-2026;12,50;test\n", { date: 0, amount: 1, communication: 2, counterparty_name: -1, counterparty_iban: -1, structured_ref: -1, external_ref: -1, description: -1 });
    expect(r.rows[0]).toMatchObject({ date: "2026-03-01", amount: 12.5, communication: "test" });
  });
});

describe("CODA-import", () => {
  const pad = (s: string, n: number) => (s + " ".repeat(n)).slice(0, n);
  const line21 = (seq: string, sign: "0" | "1", amount: string, date: string, structured: boolean, comm: string) => "2" + "1" + seq + "0000" + pad("REF" + seq, 21) + sign + amount + date + "00150000" + (structured ? "1" : "0") + pad(comm, 53) + date + "003" + pad("", 4) + "0" + "0";
  it("leest saldo, bedragen, tegenpartij en gestructureerde mededeling", () => {
    const valid = ogmDigits(ogm("0010002198"));
    const coda = ["1" + "2" + "003" + pad("BE68539007547034", 37) + "0" + "000000012500000" + "120326" + pad("VME", 26) + pad("ZICHT", 35) + "003",
      line21("0001", "0", "000000000300000", "150326", true, "101" + valid),
      "2" + "3" + "0001" + "0000" + pad("BE12345678901234", 37) + pad("CLAES MARIE", 35) + pad("", 43) + "0" + "0",
      line21("0002", "1", "000000000045990", "160326", false, "DOMICILIERING ELEKTRICITEIT"),
      "2" + "3" + "0002" + "0000" + pad("BE99888877776666", 37) + pad("ENGIE", 35) + pad("", 43) + "0" + "0",
      "8" + "003" + pad("BE68539007547034", 37) + "0" + "000000015040100" + "160326" + pad("", 64) + "0"].map((l) => l.padEnd(128)).join("\n");
    const r = parseCoda(coda);
    expect(r.old_balance).toBe(12500); expect(r.new_balance).toBe(15040.1);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toMatchObject({ date: "2026-03-15", amount: 300, counterparty_name: "CLAES MARIE", structured_ref: valid });
    expect(r.rows[1]).toMatchObject({ date: "2026-03-16", amount: -45.99, counterparty_name: "ENGIE" });
    expect(r.rows[1].communication).toContain("DOMICILIERING");
  });
});

describe("uploadvalidatie", () => {
  const f = (name: string, type = "", size = 10) => new File([new Uint8Array(size)], name, { type });
  it("laat pdf en afbeeldingen toe", () => { expect(() => validateUpload(f("factuur.pdf", "application/pdf"))).not.toThrow(); expect(() => validateUpload(f("foto.JPG", "image/jpeg"))).not.toThrow(); });
  it("weigert uitvoerbare bestanden, html en dubbele extensies", () => {
    expect(() => validateUpload(f("virus.exe"))).toThrow(); expect(() => validateUpload(f("pagina.html"))).toThrow(); expect(() => validateUpload(f("factuur.pdf.exe"))).toThrow(); expect(() => validateUpload(f("script.js"))).toThrow();
  });
  it("weigert lege en te grote bestanden", () => { expect(() => validateUpload(f("leeg.pdf", "", 0))).toThrow(); expect(() => validateUpload(f("groot.pdf", "", 51 * 1024 * 1024))).toThrow(); });
  it("geeft enkel veilige content-types voor weergave", () => { expect(safeContentType("text/html", "x.pdf")).toBe("application/pdf"); expect(safeContentType("text/html", "x.bin")).toBe("application/octet-stream"); });
});
