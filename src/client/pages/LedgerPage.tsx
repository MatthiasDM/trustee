import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Banknote, BellRing, BookOpen, BookText, Building, Calculator, Repeat, ClipboardCheck, FileSpreadsheet, Landmark, Package, PenLine, Receipt, Settings2, UserSquare2 } from "lucide-react";
import { PageHeader, Spinner } from "../components/ui";
import { useFetch } from "../components/Layout";
import { useT } from "../lib/i18n";
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
import { CashbookTab } from "../ledger/CashbookTab";
import { SuppliersTab } from "../ledger/SuppliersTab";
import { RecurringTab } from "../ledger/RecurringTab";

export function LedgerPage() {
  const { b, fys, accounts, banks, keys } = useLedgerBase(); const t = useT();
  const mode = useFetch<{ setting: string; effective: "simple" | "double"; counted_units: number; double_required: boolean }>(`/api/buildings/${b.id}/ledger/mode`);
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") ?? "overview";
  const [fyId, setFyId] = useState<string>("");
  if (fys.loading || accounts.loading || banks.loading || keys.loading || mode.loading) return <Spinner />;
  const simple = mode.data?.effective === "simple";
  const list = fys.data ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const defaultFy = list.find((x) => x.start_date <= today && x.end_date >= today) ?? list.find((x) => x.status === "open") ?? list[0];
  const fy = list.find((f) => f.id === (fyId || defaultFy?.id)) ?? null;
  const reloadAll = () => { accounts.reload(); banks.reload(); };
  const TABS = [
    { v: "overview", l: "Overzicht", I: Calculator },
    ...(simple ? [{ v: "cashbook", l: "Kasboek", I: BookText }] : []),
    ...(!simple || b.isBoard ? [{ v: "journal", l: simple ? "Boekingen" : "Dagboek", I: BookOpen }] : []),
    ...(b.isManager ? [{ v: "book", l: "Boeken", I: PenLine }] : []),
    { v: "bank", l: "Bank", I: Landmark }, { v: "calls", l: "Oproepen", I: Receipt }, { v: "mine", l: b.isBoard ? "Afrekening" : "Mijn afrekening", I: UserSquare2 },
    ...(b.isBoard ? [{ v: "followup", l: "Opvolging", I: BellRing }, { v: "suppliers", l: "Leveranciers", I: Building }, { v: "recurring", l: "Periodiek", I: Repeat }] : []),
    ...(simple ? [] : [{ v: "assets", l: "Vaste activa", I: Package }]), { v: "budget", l: "Begroting", I: Banknote }, ...(simple ? [] : [{ v: "reports", l: "Draaitabel", I: FileSpreadsheet }]), { v: "audit", l: "Controle", I: ClipboardCheck },
    ...(b.isBoard ? [{ v: "settings", l: "Instellingen", I: Settings2 }] : []),
  ].filter((t) => b.isBoard || !["bank", "assets"].includes(t.v));
  return <div>
    <PageHeader title={t("Boekhouding")} subtitle={simple ? `Vereenvoudigde boekhouding (${mode.data?.counted_units} kavels, minder dan 20): ontvangsten, uitgaven, kaspositie en werk- en reservekapitaal. Alles blijft onderliggend volledig geboekt; schakel om naar dubbel boekhouden onder Instellingen.` : "Dubbel boekhouden volgens het KB van 12 juli 2012. De syndicus boekt, raad en commissaris controleren, elke mede-eigenaar ziet de cijfers en zijn eigen afrekening."} actions={list.length > 0 && <FySelect fys={list} value={fy?.id ?? ""} onChange={setFyId} />} />
    <Tabs value={tab} onValueChange={(v) => setSp(v === "overview" ? {} : { tab: v })} className="mb-6"><TabsList className="h-auto flex-wrap">{TABS.map((t) => <TabsTrigger key={t.v} value={t.v}><t.I />{t.l}</TabsTrigger>)}</TabsList></Tabs>
    {tab === "overview" && <OverviewTab buildingId={b.id} fy={fy} isBoard={b.isBoard} />}
    {tab === "cashbook" && <CashbookTab fy={fy} />}
    {tab === "journal" && <JournalTab fy={fy} accounts={accounts.data ?? []} />}
    {tab === "book" && <BookTab accounts={accounts.data ?? []} banks={banks.data ?? []} keys={keys.data ?? []} onPosted={reloadAll} simple={simple} />}
    {tab === "bank" && <BankTab banks={banks.data ?? []} accounts={accounts.data ?? []} keys={keys.data ?? []} reloadBanks={() => banks.reload()} onPosted={reloadAll} />}
    {tab === "calls" && <CallsTab keys={keys.data ?? []} onPosted={reloadAll} />}
    {tab === "mine" && <StatementsTab fy={fy} />}
    {tab === "assets" && <AssetsTab accounts={accounts.data ?? []} onPosted={reloadAll} />}
    {tab === "budget" && <BudgetTab fy={fy} accounts={accounts.data ?? []} />}
    {tab === "reports" && <ReportsTab fy={fy} />}
    {tab === "followup" && <FollowUpTab />}
    {tab === "suppliers" && <SuppliersTab accounts={accounts.data ?? []} keys={keys.data ?? []} />}
    {tab === "recurring" && <RecurringTab accounts={accounts.data ?? []} banks={banks.data ?? []} keys={keys.data ?? []} />}
    {tab === "audit" && <AuditTab fys={list} />}
    {tab === "settings" && <SettingsTab fys={list} banks={banks.data ?? []} keys={keys.data ?? []} accounts={accounts.data ?? []} mode={mode.data!} reload={() => { fys.reload(); reloadAll(); keys.reload(); mode.reload(); }} />}
  </div>;
}
