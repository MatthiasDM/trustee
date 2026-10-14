import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { api } from "../lib/api";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { ErrorBox } from "./ui";

/** Blokkeert de app tot de gebruiker de huidige versie van voorwaarden en privacyverklaring aanvaard heeft (aanvaarding wordt gelogd). */
export function ConsentGate() {
  const { consents_required = [], refresh } = useAuth();
  const [checked, setChecked] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  if (!consents_required.length) return null;
  const accept = async () => { setBusy(true); setError(null); try { await api.post("/api/auth/consent"); await refresh(); } catch (e) { setError(e); } finally { setBusy(false); } };
  return <Dialog open><DialogContent showCloseButton={false} onEscapeKeyDown={(e) => e.preventDefault()} onPointerDownOutside={(e) => e.preventDefault()}>
    <DialogHeader><DialogTitle>Voorwaarden en privacy</DialogTitle><DialogDescription>Om Trustee te gebruiken vragen we je akkoord met de huidige versie van de <Link className="underline" to="/voorwaarden" target="_blank">algemene voorwaarden</Link> en de <Link className="underline" to="/privacy" target="_blank">privacyverklaring</Link>. Kern: Trustee is een hulpmiddel; de syndicus en de organen van de VME blijven verantwoordelijk voor de naleving van de wet.</DialogDescription></DialogHeader>
    <label className="flex items-start gap-2 text-sm"><Checkbox checked={checked} onCheckedChange={(v) => setChecked(!!v)} className="mt-0.5" /><span>Ik heb de algemene voorwaarden en de privacyverklaring gelezen en aanvaard ze.</span></label>
    <ErrorBox error={error} />
    <DialogFooter><Button disabled={!checked || busy} onClick={accept}>Aanvaarden en verdergaan</Button></DialogFooter>
  </DialogContent></Dialog>;
}
