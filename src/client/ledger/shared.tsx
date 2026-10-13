import { useBuilding, useFetch } from "../components/Layout";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";

export const eur = (n: number | null | undefined) => new Intl.NumberFormat("nl-BE", { style: "currency", currency: "EUR" }).format(n ?? 0).replace(/\s/g, "\u00a0");
export const NONE = "__none__";

export interface FiscalYear { id: string; label: string; start_date: string; end_date: string; status: string }
export interface Account { id: string; code: string; name: string; class: number; type: string; normal_side: string; fund: string | null; is_header: number; is_system: number; active: number; debit: number; credit: number; balance: number }
export interface BankAccount { id: string; name: string; iban: string | null; fund: string; code: string; balance: number; unmatched: number }
export interface CostKey { id: string; name: string; basis: string; is_default: number; weights: { unit_id: string; weight: number }[] }
export interface Entry { id: string; number: number; date: string; period: string; description: string; counterparty?: string | null; status: string; source: string; template_code?: string | null; document_id?: string | null; document_name?: string | null; created_by_name?: string; comment_count: number; total: number; lines: { id: string; code: string; account_name: string; debit: number; credit: number; unit_label?: string | null; memo?: string | null }[] }

export function useLedgerBase() {
  const b = useBuilding();
  const fys = useFetch<FiscalYear[]>(`/api/buildings/${b.id}/ledger/fiscal-years`);
  const accounts = useFetch<Account[]>(`/api/buildings/${b.id}/ledger/accounts`);
  const banks = useFetch<BankAccount[]>(`/api/buildings/${b.id}/ledger/bank-accounts`);
  const keys = useFetch<CostKey[]>(`/api/buildings/${b.id}/ledger/cost-keys`);
  return { b, fys, accounts, banks, keys };
}

export function AccountSelect({ accounts, value, onChange, filter, placeholder = "Rekening" }: { accounts: Account[]; value: string; onChange: (v: string) => void; filter?: string; placeholder?: string }) {
  const list = accounts.filter((a) => !a.is_header && a.active && (!filter || a.code.startsWith(filter)));
  return <Select value={value || NONE} onValueChange={(v) => onChange(v === NONE ? "" : v)}><SelectTrigger className="w-full"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent><SelectItem value={NONE}>— {placeholder} —</SelectItem>{list.map((a) => <SelectItem key={a.id} value={a.code}><span className="font-mono text-xs text-muted-foreground">{a.code}</span> {a.name}</SelectItem>)}</SelectContent></Select>;
}

export function FySelect({ fys, value, onChange }: { fys: FiscalYear[]; value: string; onChange: (v: string) => void }) {
  return <Select value={value} onValueChange={onChange}><SelectTrigger size="sm"><SelectValue placeholder="Boekjaar" /></SelectTrigger><SelectContent>{fys.map((f) => <SelectItem key={f.id} value={f.id}>Boekjaar {f.label}{f.status === "closed" ? " (afgesloten)" : ""}</SelectItem>)}</SelectContent></Select>;
}

export function Money({ n, className = "" }: { n: number; className?: string }) { return <span className={`tabular-nums ${n < 0 ? "text-destructive" : ""} ${className}`}>{eur(n)}</span>; }
