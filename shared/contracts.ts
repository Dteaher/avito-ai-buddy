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
}

export type CityRun = RunBase & { kind?: never; checks: CheckResult[] };
export type PriceRun = RunBase & { kind: 'price-order'; checks: [PriceResult] };
export type Run = CityRun | PriceRun;

export interface Publication {
  id: string;
  url: string;
  publishedAt: string;
  run: Run;
}

export interface BuddyQuestion {
  question: string;
  clarificationId?: string;
}

export interface BuddySource {
  instructionId: string;
  ruleNumber: number;
}

export interface BuddyAnswer {
  kind: 'guidance' | 'clarification' | 'insufficient' | 'action';
  text: string;
  mode: Workspace['buddyMode'] | 'guide-fallback';
  sources: BuddySource[];
  clarificationId?: string;
}
