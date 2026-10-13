import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Minimale PDF-opmaak voor rapporten: titels, paragrafen en tabellen met automatische pagina-einden (A4). */
export class Pdf {
  private doc!: PDFDocument; private font!: PDFFont; private bold!: PDFFont; private page!: PDFPage; private y = 0;
  private readonly W = 595.28; private readonly H = 841.89; private readonly M = 48; private pageNo = 0;
  private footer = "";
  static async create(footer: string) { const p = new Pdf(); p.doc = await PDFDocument.create(); p.font = await p.doc.embedFont(StandardFonts.Helvetica); p.bold = await p.doc.embedFont(StandardFonts.HelveticaBold); p.footer = footer; p.newPage(); return p; }
  private clean(s: string) { return (s ?? "").replace(/[^\x20-\x7E\xA0-\xFF€]/g, (ch) => ({ "≥": ">=", "≤": "<=", "—": "-", "–": "-", "…": "...", "’": "'", "“": '"', "”": '"', "€": "EUR" }[ch] ?? "?")).replace(/€/g, "EUR"); }
  private newPage() { this.page = this.doc.addPage([this.W, this.H]); this.pageNo++; this.y = this.H - this.M; this.page.drawText(this.clean(`${this.footer} - pagina ${this.pageNo}`), { x: this.M, y: 24, size: 8, font: this.font, color: rgb(0.45, 0.45, 0.45) }); }
  private need(h: number) { if (this.y - h < this.M + 10) this.newPage(); }
  private wrap(text: string, size: number, font: PDFFont, width: number): string[] {
    const out: string[] = []; for (const para of this.clean(text).split("\n")) { let line = ""; for (const w of para.split(" ")) { const t = line ? `${line} ${w}` : w; if (font.widthOfTextAtSize(t, size) > width && line) { out.push(line); line = w; } else line = t; } out.push(line); } return out;
  }
  title(t: string) { this.need(30); this.page.drawText(this.clean(t), { x: this.M, y: this.y - 18, size: 18, font: this.bold }); this.y -= 30; }
  h2(t: string) { this.need(26); this.y -= 8; this.page.drawText(this.clean(t), { x: this.M, y: this.y - 12, size: 12.5, font: this.bold }); this.page.drawLine({ start: { x: this.M, y: this.y - 16 }, end: { x: this.W - this.M, y: this.y - 16 }, thickness: 0.5, color: rgb(0.7, 0.7, 0.7) }); this.y -= 24; }
  text(t: string, size = 9.5, opts: { bold?: boolean; color?: [number, number, number] } = {}) { const font = opts.bold ? this.bold : this.font; for (const line of this.wrap(t, size, font, this.W - 2 * this.M)) { this.need(size + 4); this.page.drawText(line, { x: this.M, y: this.y - size, size, font, color: opts.color ? rgb(...opts.color) : undefined }); this.y -= size + 4; } this.y -= 2; }
  space(h = 6) { this.y -= h; }
  /** Tabel: cols = [{label, width (fractie), align}], rows = string[][]; laatste rij kan vet (totaal). */
  table(cols: { label: string; w: number; align?: "left" | "right" }[], rows: string[][], opts: { totalRow?: boolean; size?: number } = {}) {
    const size = opts.size ?? 8.5; const total = this.W - 2 * this.M; const widths = cols.map((c) => c.w * total);
    const drawRow = (cells: string[], font: PDFFont, bg?: [number, number, number]) => {
      const lines = cells.map((c, i) => this.wrap(c ?? "", size, font, widths[i] - 6));
      const h = Math.max(...lines.map((l) => l.length)) * (size + 3) + 5;
      this.need(h);
      if (bg) this.page.drawRectangle({ x: this.M, y: this.y - h, width: total, height: h, color: rgb(...bg) });
      let x = this.M;
      cells.forEach((_, i) => { lines[i].forEach((ln, li) => { const tw = font.widthOfTextAtSize(ln, size); const tx = cols[i].align === "right" ? x + widths[i] - 3 - tw : x + 3; this.page.drawText(ln, { x: tx, y: this.y - (li + 1) * (size + 3) + 1, size, font }); }); x += widths[i]; });
      this.page.drawLine({ start: { x: this.M, y: this.y - h }, end: { x: this.W - this.M, y: this.y - h }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
      this.y -= h;
    };
    drawRow(cols.map((c) => c.label), this.bold, [0.93, 0.94, 0.96]);
    rows.forEach((r, i) => drawRow(r, opts.totalRow && i === rows.length - 1 ? this.bold : this.font));
    this.y -= 6;
  }
  async bytes() { return this.doc.save(); }
}

export const money = (n: number) => `${(n ?? 0).toLocaleString("nl-BE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
export const dateNl = (s: string) => new Date(s).toLocaleDateString("nl-BE", { timeZone: "Europe/Brussels" });
