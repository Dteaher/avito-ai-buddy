export const cities = { kazan: 'Казань', samara: 'Самара' } as const;
export const groupLabels = { ...cities, active: 'Активные', archived: 'Архивные' } as const;
export type City = keyof typeof groupLabels;
export type CheckId = 'without-city' | 'kazan' | 'all-statuses' | 'active-only' | 'reindex-active';

export function checkRuleNumber(id: CheckId | 'price-asc', task?: Task) {
  if (task?.authoringId) return (task.comparison?.checks.findIndex((check) => check.id === id) ?? -1) + 1;
  return id === 'without-city' || id === 'all-statuses' ? 1 : 2;
}

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
  shortTitle?: string;
  authoringId?: string;
  description: string;
  criterion: string;
  instruction: Instruction;
  comparison?: {
    field: 'status';
    values: City[];
    checks: [CatalogCheck, ...CatalogCheck[]];
  };
}

interface RequestDefinition {
  label: string;
  path: string;
  parameter: string;
}

export interface Check extends RequestDefinition {
  id: CheckId;
  uniqueIds?: true;
}

export interface CatalogCheck extends Check {
  required: City[];
}

export interface TaskDraftInput {
  title: string;
  description: string;
  criterion: string;
  checkIds: CheckId[];
}

export interface TaskDraft {
  input: TaskDraftInput;
  revision: string;
}

export interface TaskVersion {
  version: number;
  task: Task;
  input: TaskDraftInput;
  assigned: boolean;
}

export interface TaskProject {
  id: string;
  draft?: TaskDraft;
  versions: TaskVersion[];
}

export interface TaskEditorData {
  catalog: CatalogCheck[];
  projects: TaskProject[];
  trainees: DemoIdentity[];
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
  attemptId?: string;
  assignmentOffers?: AssignmentOffer[];
}

export interface AssignmentOffer {
  id: string;
  title: string;
  criterion: string;
  version: string;
  assignedVersion?: string;
  traineeId: DemoIdentityId;
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
  expectedUniqueIds?: boolean;
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
  duplicateIds?: string[];
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
  attempt?: { first?: AttemptChoice; final: AttemptChoice; help: 'none' | 'before-choice' | 'after-choice' };
}

export interface AttemptChoice {
  checkId: CheckId;
  expected: City[];
  checks: CheckInput[];
}

export interface Preparation {
  question: string;
  checkId: DraftCheck['id'];
  source: 'buddy-draft';
}

export type CityRun = RunBase & { kind?: never; checks: CheckResult[] };
export type PriceRun = RunBase & { kind: 'price-order'; checks: [PriceResult] };
export type Run = CityRun | PriceRun;

export type TrackerDelivery = { status: 'pending' | 'blocked' } | { status: 'delivered'; id: string };

export interface Publication {
  id: string;
  url: string;
  publishedAt: string;
  run: Run;
  conclusion?: string;
  tracker?: TrackerDelivery;
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
  trackerStatus?: TrackerDelivery['status'];
  title?: string;
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
  attemptId?: string;
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
