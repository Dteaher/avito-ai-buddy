export const cities = { kazan: 'Казань', samara: 'Самара' } as const;
export type City = keyof typeof cities;
export type CheckId = 'without-city' | 'kazan';

export interface Instruction {
  id: string;
  title: string;
  team: string;
  version: string;
  rules: string[];
}

export interface Task {
  id: string;
  title: string;
  description: string;
  criterion: string;
  instruction: Instruction;
}

interface RequestDefinition {
  label: string;
  path: string;
  parameter: string;
}

export interface Check extends RequestDefinition {
  id: CheckId;
}

export interface PriceCheck extends RequestDefinition {
  id: 'price-asc';
}

interface WorkspaceBase {
  task: Task;
  tasks: Task[];
  buddyMode: 'guide' | 'model';
  buddyProvider?: 'local' | 'remote';
  identity?: DemoIdentity;
  standFixed?: boolean;
}

export type DemoIdentityId = 'demo-trainee' | 'demo-trainee-b' | 'demo-mentor';
export interface DemoIdentity {
  id: DemoIdentityId;
  name: string;
  role: 'trainee' | 'mentor';
}

export type Workspace = WorkspaceBase & (
  | { kind?: never; checks: Check[] }
  | { kind: 'price-order'; checks: [PriceCheck]; orderItems: PriceListing[] }
);

export interface CheckInput {
  id: CheckId;
  expectedCities: City[];
}

export interface Listing {
  id: string;
  title: string;
  city: City;
}

export interface PriceListing {
  id: string;
  title: string;
  price: number | null;
}

interface ResponseSnapshot {
  standMode?: 'defect' | 'fixed';
  status: number;
  rawBody: string;
  matches: boolean;
  followsRule: boolean;
}

export interface CheckResult extends Check, CheckInput, ResponseSnapshot {
  items: Listing[];
  actualCities: City[];
  ruleCities: City[];
  missing: City[];
  extra: City[];
}

export interface PriceResult extends PriceCheck, ResponseSnapshot {
  items: PriceListing[];
  fixtures: PriceListing[];
  expectedOrder: string[];
  actualOrder: string[];
  ruleOrder: string[];
  sameItems: boolean;
}

interface RunBase {
  id: string;
  task: Task;
  checkedAt: string;
  preparation?: Preparation;
}

export interface Preparation {
  question: string;
  checkId: DraftCheck['id'];
  source: 'buddy-draft';
}

export type CityRun = RunBase & { kind?: never; checks: CheckResult[] };
export type PriceRun = RunBase & { kind: 'price-order'; checks: [PriceResult] };
export type Run = CityRun | PriceRun;

export interface Publication {
  id: string;
  url: string;
  publishedAt: string;
  run: Run;
  conclusion?: string;
  review?: { decision: 'accepted' | 'returned'; comment: string; reviewedAt: string };
  replay?: Run;
  replayBy?: DemoIdentityId;
  previous?: { id: string; runId: string; conclusion?: string; review?: Publication['review'] };
  nextId?: string;
}

export interface RecordListItem {
  id: string;
  taskId: string;
  publishedAt: string;
  decision: 'accepted' | 'returned' | null;
  previousId?: string;
  nextId?: string;
}

export type DraftCheck = CheckInput | { id: 'price-asc'; expectedOrder: string[] };
export interface CheckDraft {
  checkId: DraftCheck['id'];
  path: string;
  checks: DraftCheck[];
}

export interface BuddyQuestion {
  question: string;
  clarificationId?: string;
  conversationId?: string;
  runId?: string;
  intent?: 'plan' | 'review';
  mode?: 'guide' | 'manual';
}

export interface RunEvidenceSource {
  runId: string;
  checkId: CheckId | PriceCheck['id'];
  label: string;
}

export type BuddySource = { instructionId: string; ruleNumber: number } | RunEvidenceSource;

export interface BuddyAnswer {
  kind: 'guidance' | 'clarification' | 'insufficient' | 'action' | 'draft' | 'feedback';
  text: string;
  mode: Workspace['buddyMode'] | 'guide-fallback';
  sources: BuddySource[];
  clarificationId?: string;
  conversationId?: string;
  fallbackReason?: 'unavailable' | 'invalid-response';
  draft?: CheckDraft;
  facts?: string[];
  verdicts?: ClaimVerdict[];
  note?: string;
  escalation?: string;
}

export interface ClaimVerdict {
  status: 'confirmed' | 'refuted' | 'observation' | 'unclear';
  text: string;
}
