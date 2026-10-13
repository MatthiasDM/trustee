import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Banknote, BellRing, BookOpen, Calculator, ClipboardCheck, FileSpreadsheet, Landmark, Package, PenLine, Receipt, Settings2, UserSquare2 } from "lucide-react";
import { PageHeader, Spinner } from "../components/ui";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { FySelect, useLedgerBase } from "../ledger/shared";
import { OverviewTab } from "../ledger/OverviewTab";
import { JournalTab } from "../ledger/JournalTab";
import { BookTab } from "../ledger/BookTab";
import { BankTab } from "../ledger/BankTab";
import { CallsTab } from "../ledger/CallsTab";
import { StatementsTab } from "../ledger/StatementsTab";
import { AssetsTab } from "../ledger/AssetsTab";
import { BudgetTab } from "../ledger/BudgetTab";
import { ReportsTab } from "../ledger/ReportsTab";
import { SettingsTab } from "../ledger/SettingsTab";
import { FollowUpTab } from "../ledger/FollowUpTab";
import { AuditTab } from "../ledger/AuditTab";

export function LedgerPage() {
  const { b, fys, accounts, banks, keys } = useLedgerBase();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "overview";
  const [fyId, setFyId] = useState<string>("");
  if (fys.loading || accounts.loading || banks.loading || keys.loading) return <Spinner />;
  const list = fys.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const defaultFy = list.find((x) => x.start_date <= today && x.end_date >= today) ?? list.find((x) => x.status === "open") ?? list[0];
  const fy = list.find((f) => f.id === (fyId || defaultFy?.id)) ?? null;
  const reloadAll = () => { accounts.reload(); banks.reload(); };
  const TABS = [
    { v: "overview", l: "Overzicht", I: Calculator }, { v: "journal", l: "Dagboek", I: BookOpen },
    ...(b.isManager ? [{ v: "book", l: "Boeken", I: PenLine }] : []),
    { v: "bank", l: "Bank", I: Landmark }, { v: "calls", l: "Oproepen", I: Receipt }, { v: "mine", l: b.isBoard ? "Afrekening" : "Mijn afrekening", I: UserSquare2 },
    ...(b.isBoard ? [{ v: "followup", l: "Opvolging", I: BellRing }] : []),
    { v: "assets", l: "Vaste activa", I: Package }, { v: "budget", l: "Begroting", I: Banknote }, { v: "reports", l: "Draaitabel", I: FileSpreadsheet }, { v: "audit", l: "Controle", I: ClipboardCheck },
    ...(b.isBoard ? [{ v: "settings", l: "Instellingen", I: Settings2 }] : []),
  ].filter((t) => b.isBoard || !["bank", "assets"].includes(t.v));
  return <div>
    <PageHeader title="Boekhouding" subtitle="Dubbel boekhouden volgens het KB van 12 juli 2012. De syndicus boekt, raad en commissaris controleren, elke mede-eigenaar ziet de cijfers en zijn eigen afrekening." actions={list.length > 0 && <FySelect fys={list} value={fy?.id ?? ""} onChange={setFyId} />} />
    <Tabs value={tab} onValueChange={(v) => setSp(v === "overview" ? {} : { tab: v })} className="mb-6"><TabsList className="h-auto flex-wrap">{TABS.map((t) => <TabsTrigger key={t.v} value={t.v}><t.I />{t.l}</TabsTrigger>)}</TabsList></Tabs>
    {tab === "overview" && <OverviewTab buildingId={b.id} fy={fy} isBoard={b.isBoard} />}
    {tab === "journal" && <JournalTab fy={fy} accounts={accounts.data ?? []} />}
    {tab === "book" && <BookTab accounts={accounts.data ?? []} banks={banks.data ?? []} keys={keys.data ?? []} onPosted={reloadAll} />}
    {tab === "bank" && <BankTab banks={banks.data ?? []} accounts={accounts.data ?? []} keys={keys.data ?? []} reloadBanks={() => banks.reload()} onPosted={reloadAll} />}
    {tab === "calls" && <CallsTab keys={keys.data ?? []} onPosted={reloadAll} />}
    {tab === "mine" && <StatementsTab fy={fy} />}
    {tab === "assets" && <AssetsTab accounts={accounts.data ?? []} onPosted={reloadAll} />}
    {tab === "budget" && <BudgetTab fy={fy} accounts={accounts.data ?? []} />}
    {tab === "reports" && <ReportsTab fy={fy} />}
    {tab === "followup" && <FollowUpTab />}
    {tab === "audit" && <AuditTab fys={list} />}
    {tab === "settings" && <SettingsTab fys={list} banks={banks.data ?? []} keys={keys.data ?? []} accounts={accounts.data ?? []} reload={() => { fys.reload(); reloadAll(); keys.reload(); }} />}
  </div>;
}
