import type { Task } from '../shared/contracts.ts';

export const archiveTask: Task = {
  id: 'ARCHIVE-01',
  title: 'Проверь, остаются ли архивные товары в выдаче',
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

export const products = [
  { id: 'sku-301', title: 'Рюкзак', status: 'active' },
  { id: 'sku-302', title: 'Фонарь', status: 'archived' },
] as const;
