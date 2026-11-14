import type { DemoIdentity, DemoIdentityId } from '../shared/contracts.ts';
import { trainee } from './scenario.ts';

export const identities: DemoIdentity[] = [
  { id: trainee, name: 'Стажёр А', role: 'trainee' },
  { id: 'demo-trainee-b', name: 'Стажёр Б', role: 'trainee' },
  { id: 'demo-mentor', name: 'Наставник', role: 'mentor' },
];

export function findIdentity(id: unknown) {
  return identities.find((identity) => identity.id === id);
}

export function assignedTrainee(id: DemoIdentityId) {
  return id === 'demo-mentor' ? trainee : id;
}
