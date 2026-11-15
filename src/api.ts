export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(path, options).catch(() => {
    throw new Error('Нет связи с сервером. Проверь, что приложение запущено, и повтори действие.');
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || data === null) {
    throw new Error(data?.message ?? 'Сервис временно недоступен. Попробуй ещё раз.');
  }
  return data as T;
}

export function post<T>(path: string, body: object = {}, signal?: AbortSignal) {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
}

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Попробуй ещё раз.';
}
