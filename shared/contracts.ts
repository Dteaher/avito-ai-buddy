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

export interface Check {
  id: CheckId;
  label: string;
  path: string;
  parameter: string;
}

export interface Workspace {
  task: Task;
  checks: Check[];
  buddyMode: 'guide' | 'model';
}

export interface CheckInput {
  id: CheckId;
  expectedCities: City[];
}

export interface Listing {
  id: string;
  title: string;
  city: City;
}

export interface CheckResult extends Check, CheckInput {
  status: number;
  items: Listing[];
  rawBody: string;
  actualCities: City[];
  ruleCities: City[];
  missing: City[];
  extra: City[];
  matches: boolean;
  followsRule: boolean;
}

export interface Run {
  id: string;
  task: Task;
  checkedAt: string;
  checks: CheckResult[];
}

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
