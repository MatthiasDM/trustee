import { useState } from "react";
import { KeyRound, LogOut, ShieldCheck, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

/** Beveiliging van het account: tweestapsverificatie (TOTP) en alle sessies beëindigen. */
export function SecurityCard() {
  const { security, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauth: string; qr: string } | null>(null);
  const [code, setCode] = useState(""); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [disable, setDisable] = useState(false); const [pw, setPw] = useState("");
  const start = async () => { setError(null); const r = await api.post<{ secret: string; otpauth: string }>("/api/auth/totp/setup"); setSetup({ ...r, qr: await QRCode.toDataURL(r.otpauth, { margin: 1, width: 180 }) }); setCode(""); };
  const enable = async () => { setBusy(true); setError(null); try { const r = await api.post<{ recovery_codes: string[] }>("/api/auth/totp/enable", { code }); setRecovery(r.recovery_codes); setSetup(null); await refresh(); } catch (e) { setError(e); } finally { setBusy(false); } };
  return <Card><CardHeader><CardTitle>Beveiliging</CardTitle><CardDescription>Tweestapsverificatie beschermt je account met een code uit een authenticator-app (bv. Google Authenticator, 1Password, Microsoft Authenticator). Sterk aanbevolen voor syndici en kantoorleden.</CardDescription></CardHeader><CardContent className="grid gap-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm">{security?.totp_enabled ? <><ShieldCheck className="size-4 text-emerald-600" />Tweestapsverificatie is <strong>actief</strong></> : <><ShieldOff className="size-4 text-amber-600" />Tweestapsverificatie is <strong>niet actief</strong></>}</div>
      {security?.totp_enabled ? <Button variant="outline" size="sm" onClick={() => { setDisable(true); setCode(""); setPw(""); setError(null); }}>Uitschakelen</Button> : <Button size="sm" onClick={start}><KeyRound />Inschakelen</Button>}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><div className="text-sm">Actieve sessies: <strong>{security?.sessions ?? 1}</strong><div className="text-xs text-muted-foreground">Toestel verloren of verdachte activiteit? Beëindig alle andere sessies.</div></div><Button variant="outline" size="sm" onClick={async () => { const r = await api.post<{ ended: number }>("/api/auth/logout-all"); toast.success(`${r.ended} andere sessie(s) beëindigd`); await refresh(); }}><LogOut />Andere sessies afmelden</Button></div>

    <Dialog open={!!setup} onOpenChange={(o) => !o && setSetup(null)}><DialogContent>
      <DialogHeader><DialogTitle>Tweestapsverificatie inschakelen</DialogTitle><DialogDescription>Scan de QR-code met je authenticator-app of voer het geheim handmatig in. Vul daarna de code uit de app in.</DialogDescription></DialogHeader>
      {setup && <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-start"><img src={setup.qr} alt="QR-code voor authenticator" className="rounded-lg border" width={180} height={180} /><div className="grid gap-3"><div><div className="text-xs text-muted-foreground">Geheim (handmatig)</div><code className="block rounded bg-muted px-2 py-1 text-xs break-all select-all">{setup.secret}</code></div><Field label="Code uit de app"><Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} /></Field></div></div>}
      <ErrorBox error={error} />
      <DialogFooter><Button variant="outline" onClick={() => setSetup(null)}>Annuleren</Button><Button disabled={busy || code.replace(/\s/g, "").length !== 6} onClick={enable}>Bevestigen</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={!!recovery} onOpenChange={(o) => !o && setRecovery(null)}><DialogContent>
      <DialogHeader><DialogTitle>Herstelcodes</DialogTitle><DialogDescription>Bewaar deze codes op een veilige plaats. Elke code werkt één keer en vervangt de authenticator als je je toestel kwijt bent. Ze worden niet opnieuw getoond.</DialogDescription></DialogHeader>
      <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-3 font-mono text-sm">{recovery?.map((c) => <div key={c}>{c}</div>)}</div>
      <DialogFooter><Button variant="outline" onClick={() => navigator.clipboard?.writeText(recovery?.join("\n") ?? "").then(() => toast.success("Gekopieerd"))}>Kopiëren</Button><Button onClick={() => setRecovery(null)}>Ik heb ze bewaard</Button></DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={disable} onOpenChange={setDisable}><DialogContent>
      <DialogHeader><DialogTitle>Tweestapsverificatie uitschakelen</DialogTitle><DialogDescription>Bevestig met je wachtwoord en een actuele code.</DialogDescription></DialogHeader>
      <Field label="Wachtwoord"><Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Code uit de app"><Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} /></Field>
      <ErrorBox error={error} />
      <DialogFooter><Button variant="outline" onClick={() => setDisable(false)}>Annuleren</Button><Button variant="destructive" disabled={!pw || code.length < 6} onClick={async () => { setError(null); try { await api.post("/api/auth/totp/disable", { password: pw, code }); setDisable(false); await refresh(); toast.success("Tweestapsverificatie uitgeschakeld"); } catch (e) { setError(e); } }}>Uitschakelen</Button></DialogFooter>
    </DialogContent></Dialog>
  </CardContent></Card>;
}
