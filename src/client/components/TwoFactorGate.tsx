import { useEffect, useState } from "react";
import { KeyRound, LogOut } from "lucide-react";
import { toast } from "sonner";
import QRCode from "qrcode";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { ErrorBox, Field } from "./ui";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

/**
 * Wie een gebouw beheert (syndicus, kantoormedewerker, voorlopig syndicus, vereffenaar, platformbeheer) moet tweestapsverificatie hebben.
 * Deze dialoog blokkeert de app tot ze is ingeschakeld; de server weigert intussen elke beheerhandeling (code totp_required).
 */
export function TwoFactorGate() {
  const { user, security, refresh, logout } = useAuth(); const nav = useNavigate();
  const [forced, setForced] = useState(false);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState(""); const [error, setError] = useState<unknown>(null); const [busy, setBusy] = useState(false);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  useEffect(() => { const on = () => setForced(true); window.addEventListener("trustee:totp-required", on); return () => window.removeEventListener("trustee:totp-required", on); }, []);
  if (!user) return null;
  if (recovery) return <Dialog open><DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
    <DialogHeader><DialogTitle>Herstelcodes</DialogTitle><DialogDescription>Bewaar deze codes op een veilige plaats. Elke code werkt één keer en vervangt de authenticator als je je toestel kwijt bent. Ze worden niet opnieuw getoond.</DialogDescription></DialogHeader>
    <div className="grid grid-cols-2 gap-1 rounded-lg border bg-muted/40 p-3 font-mono text-sm">{recovery.map((c) => <div key={c}>{c}</div>)}</div>
    <DialogFooter><Button variant="outline" onClick={() => navigator.clipboard?.writeText(recovery.join("\n")).then(() => toast.success("Gekopieerd"))}>Kopiëren</Button><Button onClick={() => { setRecovery(null); setForced(false); window.location.reload(); }}>Ik heb ze bewaard</Button></DialogFooter>
  </DialogContent></Dialog>;
  if (security?.totp_enabled || !(security?.totp_required || forced)) return null;
  const start = async () => { setError(null); try { const r = await api.post<{ secret: string; otpauth: string }>("/api/auth/totp/setup"); setSetup({ secret: r.secret, qr: await QRCode.toDataURL(r.otpauth, { margin: 1, width: 180 }) }); setCode(""); } catch (e) { setError(e); } };
  const enable = async () => { setBusy(true); setError(null); try { const r = await api.post<{ recovery_codes: string[] }>("/api/auth/totp/enable", { code }); setRecovery(r.recovery_codes); setSetup(null); await refresh(); } catch (e) { setError(e); } finally { setBusy(false); } };
  return <Dialog open><DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
    <DialogHeader><DialogTitle>Tweestapsverificatie is verplicht</DialogTitle><DialogDescription>Je beheert een gebouw of een syndicuskantoor. Daarvoor vraagt Trustee naast je wachtwoord een code uit een authenticator-app (bv. Google Authenticator, 1Password, Microsoft Authenticator). Zolang ze niet is ingeschakeld, kan je niets beheren.</DialogDescription></DialogHeader>
    {setup && <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-start"><img src={setup.qr} alt="QR-code voor authenticator" className="rounded-lg border" width={180} height={180} /><div className="grid gap-3"><div><div className="text-xs text-muted-foreground">Geheim (handmatig)</div><code className="block rounded bg-muted px-2 py-1 text-xs break-all select-all">{setup.secret}</code></div><Field label="Code uit de app"><Input inputMode="numeric" autoComplete="one-time-code" placeholder="123456" value={code} onChange={(e) => setCode(e.target.value)} /></Field></div></div>}
    <ErrorBox error={error} />
    <DialogFooter className="sm:justify-between"><Button variant="ghost" onClick={async () => { await logout(); nav("/login"); }}><LogOut />Afmelden</Button>
      {setup ? <Button disabled={busy || code.replace(/\s/g, "").length !== 6} onClick={enable}>Bevestigen</Button> : <Button onClick={start}><KeyRound />Inschakelen</Button>}</DialogFooter>
  </DialogContent></Dialog>;
}
