import { groupLabels, type CatalogCheck, type Task, type TaskDraftInput } from '../shared/contracts.ts';
import { activeFilterTask } from './archive-scenario.ts';
import { isObject } from './scenario.ts';

const reindex: CatalogCheck = {
  id: 'reindex-active',
  label: 'Активные товары после переиндексации',
  path: '/demo/inventory/reindex',
  parameter: 'Снимок индекса',
  required: ['active'],
  uniqueIds: true,
};

export const authoringCatalog = [reindex, ...activeFilterTask.comparison!.checks];
export const authoredTaskId = /^TASK-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}-v[1-9]\d*$/;

export function parseDraft(body: unknown): TaskDraftInput | undefined {
  if (!isObject(body) || Object.keys(body).length !== 4) return;
  const { title, description, criterion, checkIds } = body;
  const valid = (text: unknown, max: number): text is string => typeof text === 'string' && text.trim().length <= max;
  if (!valid(title, 80) || !valid(description, 600) || !valid(criterion, 240) || !Array.isArray(checkIds)
    || new Set(checkIds).size !== checkIds.length
    || checkIds.some((id) => !authoringCatalog.some((check) => check.id === id))) return;
  return { title: title.trim(), description: description.trim(), criterion: criterion.trim(), checkIds };
}

export function publishTask(id: string, version: number, input: TaskDraftInput): Task {
  const checks = input.checkIds.map((id) => authoringCatalog.find((check) => check.id === id)!) as [CatalogCheck, ...CatalogCheck[]];
  return {
    id: `${id}-v${version}`,
    authoringId: id,
    title: input.title,
    description: input.description,
    criterion: input.criterion,
    instruction: {
      id, title: 'Правило поручения', team: 'Демо-команда каталога', version: `${version}.0`,
      rules: checks.map((check) => `GET ${check.path} возвращает группы «${check.required.map((group) => groupLabels[group]).join(', ')}».${check.uniqueIds ? ' ID товаров должны быть уникальны.' : ''}`),
    },
    comparison: { field: 'status', values: ['active', 'archived'], checks },
  };
}
