import { computed, ref, shallowRef } from 'vue';
import type { BoardState } from '@core/types';

/** Состояние доски — проекция файловой системы с сервера; обновляется опросом и после каждого действия. */
export const state = shallowRef<BoardState | null>(null);
export const connection = ref<'connecting' | 'online' | 'offline'>('connecting');
/** Сервер требует вход по паролю. */
export const locked = ref(false);
export const chatOpen = ref(false);

const POLL_MS = 2500;
let snapshot = '';
let timer: ReturnType<typeof setInterval> | undefined;

export async function refresh(): Promise<void> {
  try {
    const response = await fetch('/api/state', { headers: { Accept: 'application/json' } });
    if (response.status === 401) {
      locked.value = true;
      connection.value = 'online';
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    locked.value = false;
    connection.value = 'online';
    if (text === snapshot) return; // ничего не изменилось — реактивность не будим
    snapshot = text;
    state.value = JSON.parse(text) as BoardState;
  } catch {
    connection.value = 'offline';
  }
}

export function startPolling(): void {
  stopPolling();
  void refresh();
  timer = setInterval(() => void refresh(), POLL_MS);
}

export function stopPolling(): void {
  if (timer !== undefined) clearInterval(timer);
  timer = undefined;
}

/** Прочитать доску сразу после действия — не дожидаясь опроса. */
export const sync = (): Promise<void> => refresh();

export const unreadCount = computed(() => state.value?.questions.filter((q) => q.lastFrom === 'agent').length ?? 0);

export const projectName = (id: string): string => state.value?.projects.find((p) => p.id === id)?.name ?? id;

export const cardTitle = (id: string): string => state.value?.cards.find((c) => c.id === id)?.title ?? id;
