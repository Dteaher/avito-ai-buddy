import type { Task } from '../shared/contracts.ts';

export const archiveTask: Task = {
  id: 'ARCHIVE-01',
  title: 'Проверь, остаются ли архивные товары в выдаче',
  shortTitle: 'Архивные товары',
  description: 'Выбери запрос, по которому можно обнаружить пропажу архивных товаров. Запиши ожидаемый состав до проверки. Затем сравни с контрольным запросом.',
  criterion: 'Без фильтра должны быть активные и архивные товары. С фильтром status=active — только активные.',
  instruction: {
    id: 'inventory-status-v1', title: 'Правило выдачи товаров по статусу', team: 'Демо-команда каталога', version: '1.0',
    rules: [
      'Без фильтра выдача сохраняет активные и архивные товары.',
      'Запрос с status=active возвращает только активные товары.',
      'HTTP 200 говорит об успешном ответе. Сверь группы товаров в ответе каждого запроса.',
    ],
  },
  comparison: {
    field: 'status', values: ['active', 'archived'],
    checks: [
      { id: 'all-statuses', label: 'Без фильтра', path: '/demo/inventory', parameter: 'Без фильтра', required: ['active', 'archived'] },
      { id: 'active-only', label: 'По активным', path: '/demo/inventory?status=active', parameter: 'status=active', required: ['active'] },
    ],
  },
};

export const activeFilterTask: Task = {
  id: 'ACTIVE-01',
  title: 'Проверь, исключает ли фильтр архивные товары',
  shortTitle: 'Фильтр активных',
  description: 'В общей выдаче архивные товары допустимы. Выбери запрос, который покажет, скрывает ли их фильтр по активным товарам.',
  criterion: 'С фильтром status=active должны вернуться только активные товары. Без фильтра в выдаче есть обе группы.',
  instruction: {
    id: 'inventory-active-filter-v1', title: 'Правило фильтра активных товаров', team: 'Демо-команда каталога', version: '1.0',
    rules: [
      'Без фильтра в общей выдаче есть активные и архивные товары. Этот запрос проверяет, что обе группы присутствуют на стенде.',
      'Запрос с status=active возвращает только активные товары. Архивный товар в таком ответе нарушает правило.',
      'Сверь состав обоих ответов. Статус HTTP 200 сам по себе не подтверждает, что фильтр работает.',
    ],
  },
  comparison: {
    field: 'status', values: ['active', 'archived'],
    checks: [
      { id: 'active-only', label: 'По активным', path: '/demo/inventory/filter-check?status=active', parameter: 'status=active', required: ['active'] },
      { id: 'all-statuses', label: 'Без фильтра', path: '/demo/inventory/filter-check', parameter: 'Без фильтра', required: ['active', 'archived'] },
    ],
  },
};

export const inventoryTasks = [archiveTask, activeFilterTask];

export const products = [
  { id: 'sku-301', title: 'Рюкзак', status: 'active' },
  { id: 'sku-302', title: 'Фонарь', status: 'archived' },
] as const;
