import type { BoardState, CardDetail, CardPatch, CardSummary, Project, PromptName } from '@core/types';

/** Ошибка API с готовым текстом для владельца (сервер присылает { error }). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.ok) return (await response.json()) as T;
  let message = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    /* ответ не JSON — оставляем статус */
  }
  throw new ApiError(message, response.status);
}

const get = <T>(path: string): Promise<T> =>
  fetch(path, { headers: { Accept: 'application/json' } }).then((r) => parse<T>(r));

const post = <T>(path: string, body: unknown = {}): Promise<T> =>
  fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => parse<T>(r));

const upload = <T>(path: string, file: Blob): Promise<T> =>
  fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: file }).then((r) =>
    parse<T>(r),
  );

const query = (params: Record<string, string>): string => new URLSearchParams(params).toString();

export const assetUrl = (params: Record<string, string>): string => `/api/asset?${query(params)}`;
export const chatAssetUrl = (params: Record<string, string>): string => `/api/chat-asset?${query(params)}`;

export const api = {
  state: (): Promise<BoardState> => get('/api/state'),
  card: (id: string): Promise<CardDetail> => get(`/api/card?id=${encodeURIComponent(id)}`),
  prompt: (id: string, role: PromptName): Promise<{ prompt: string }> => get(`/api/prompt?${query({ id, role })}`),
  createCard: (body: {
    title: string;
    body: string;
    project: string;
    priority: number;
  }): Promise<{ card: CardSummary }> => post('/api/card', body),
  editCard: (body: CardPatch & { id: string }): Promise<{ card: CardSummary }> => post('/api/card/edit', body),
  moveCard: (id: string, to: string): Promise<{ card: CardSummary }> => post('/api/card/move', { id, to }),
  deleteCard: (id: string): Promise<{ column: string }> => post('/api/card/delete', { id }),
  addColumn: (name: string): Promise<{ added: string }> => post('/api/columns', { action: 'add', name }),
  deleteColumn: (name: string): Promise<{ deleted: string }> => post('/api/columns', { action: 'delete', name }),
  addProject: (body: { name: string; path: string }): Promise<{ project: Project }> => post('/api/project', body),
  sendMessage: (thread: string, text: string): Promise<{ file: string }> => post('/api/chat', { q: thread, text }),
  attachCard: (id: string, file: Blob, name: string): Promise<{ file: string }> =>
    upload(`/api/attach?${query({ card: id, name })}`, file),
  attachThread: (thread: string, file: Blob, name: string): Promise<{ file: string }> =>
    upload(`/api/chat-attach?${query({ q: thread, name })}`, file),
  login: (password: string): Promise<{ ok: true }> => post('/api/login', { password }),
};
