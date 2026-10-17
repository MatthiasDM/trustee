import { useState } from "react";
import { ArrowRightLeft } from "lucide-react";
import { useBuilding } from "./Layout";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { api } from "../lib/api";

/** Gebouw overdragen aan een ander syndicuskantoor (ook midden in een boekjaar). */
export function HandoverCard() {
  const b = useBuilding();
  const [code, setCode] = useState<string | null>(null);
  if (!b.isManager) return null;
  return <Card><CardHeader><CardTitle>Overdracht naar een ander syndicuskantoor</CardTitle><CardDescription>Heeft de AV een nieuwe syndicus van een ander kantoor aangesteld, maak dan een overdrachtscode. Een beheerder van het nieuwe kantoor neemt het gebouw ermee over; leden, documenten, boekhouding en het lopende boekjaar gaan mee (art. 3.89 §5, 7° BW). Je kantoor verliest daarna de toegang.</CardDescription></CardHeader><CardContent className="text-sm">
    {code ? <div className="grid gap-1"><div>Code (14 dagen geldig): <code className="rounded bg-muted px-2 py-1 font-mono text-base tracking-widest select-all">{code}</code></div><div className="text-xs text-muted-foreground">Geef ze aan het nieuwe kantoor; zij gebruiken ze in hun kantoorportaal bij <em>Gebouw overnemen</em>.</div></div>
      : <Button variant="outline" onClick={async () => setCode((await api.post<{ code: string }>(`/api/buildings/${b.id}/handover`)).code)}><ArrowRightLeft />Overdrachtscode maken</Button>}
  </CardContent></Card>;
}
