import type { Env } from "../env";

export async function sendEmail(env: Env, to: string, subject: string, html: string, text?: string) {
  if (!env.RESEND_API_KEY) {
    console.log(`[email:dev] to=${to} subject=${subject}\n${text ?? html}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [to], subject, html, text }),
  });
  if (!res.ok) console.error("email failed", res.status, await res.text());
}

export function layout(env: Env, title: string, bodyHtml: string, cta?: { label: string; url: string }) {
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f5f7;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:32px;border:1px solid #e5e7eb">
    <div style="font-weight:700;font-size:18px;color:#0f172a;margin-bottom:16px">${env.APP_NAME}</div>
    <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a">${title}</h2>
    <div style="color:#334155;line-height:1.55">${bodyHtml}</div>
    ${cta ? `<p style="margin-top:24px"><a href="${cta.url}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${cta.label}</a></p>` : ""}
    <p style="margin-top:28px;font-size:12px;color:#94a3b8">Je ontvangt deze e-mail omdat je lid bent van een VME op ${env.APP_NAME}.</p>
  </div></body></html>`;
}
