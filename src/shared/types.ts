export type Role = "syndicus" | "raad" | "eigenaar" | "huurder" | "commissaris";
export type DocVisibility = "all" | "raad" | "syndicus" | "owners_only";
export type PostType = "question" | "announcement" | "incident";
export type PostStatus = "open" | "answered" | "in_progress" | "resolved" | "closed";
export type Majority = "simple" | "two_thirds" | "four_fifths" | "unanimous" | "none";

export const ROLE_LABELS: Record<Role, string> = {
  syndicus: "Syndicus",
  raad: "Raad van mede-eigendom",
  eigenaar: "Mede-eigenaar",
  huurder: "Huurder",
  commissaris: "Commissaris van de rekeningen",
};

export const DOC_CATEGORIES: Record<string, string> = {
  statuten: "Statuten & basisakte",
  reglement: "Reglement van interne orde",
  verslag_av: "Verslagen algemene vergadering",
  boekhouding: "Boekhouding & afrekeningen",
  offerte: "Offertes",
  factuur: "Facturen",
  verzekering: "Verzekeringen",
  contract: "Contracten",
  overig: "Overige",
};

export const MAJORITY_LABELS: Record<Majority, string> = {
  none: "Peiling (niet bindend)",
  simple: "Volstrekte meerderheid (>50%)",
  two_thirds: "2/3 meerderheid",
  four_fifths: "4/5 meerderheid",
  unanimous: "Eenparigheid",
};

export interface User { id: string; email: string; name: string; phone?: string | null; locale: string; is_superadmin: number; created_at: string }
export interface Building { id: string; org_id: string; name: string; address: string; city?: string | null; postal_code?: string | null; enterprise_number?: string | null; total_shares: number; role?: Role; org_name?: string }
export interface Unit { id: string; building_id: string; label: string; type: string; floor?: string | null; shares: number; owners?: { user_id: string; name: string; email: string; share_pct: number }[] }
export interface Member { user_id: string; name: string; email: string; phone?: string | null; role: Role; joined_at: string; units?: string }
export interface Folder { id: string; parent_id: string | null; name: string; visibility: string }
export interface Doc { id: string; folder_id: string | null; name: string; description?: string | null; category: string; size: number; mime: string; visibility: DocVisibility; uploaded_by_name?: string; created_at: string; version: number }
export interface Post { id: string; type: PostType; title: string; body: string; status: PostStatus; priority: string; pinned: number; visibility: string; author_id: string; author_name: string; author_role?: Role; created_at: string; updated_at: string; comment_count?: number }
export interface Comment { id: string; post_id: string; author_id: string; author_name: string; author_role?: Role; body: string; is_answer: number; created_at: string }
export interface PollOption { id: string; label: string; position: number; votes?: number; weight?: number; voters?: string[] }
export interface Poll { id: string; title: string; description?: string | null; weighted: number; anonymous: number; multiple: number; owners_only: number; required_majority: Majority; opens_at: string; closes_at?: string | null; status: string; created_by: string; created_by_name?: string; created_at: string; options?: PollOption[]; my_votes?: string[]; total_weight?: number; total_voters?: number; eligible_weight?: number; eligible_voters?: number }
export interface Meeting { id: string; title: string; type: string; starts_at: string; location?: string | null; agenda?: string | null; minutes_document_id?: string | null; rsvp_counts?: { attending: number; proxy: number; absent: number }; my_rsvp?: string | null }
export interface Notification { id: string; building_id?: string | null; type: string; title: string; body?: string | null; link?: string | null; read_at?: string | null; created_at: string }
