import { computed, reactive, ref, shallowRef, watch } from 'vue';
import type { BoardState, CardSummary } from '@core/types';

/** Состояние доски — проекция файловой системы с сервера; обновляется опросом и после каждого действия. */
export const state = shallowRef<BoardState | null>(null);
export const connection = ref<'connecting' | 'online' | 'offline'>('connecting');
/** Сервер требует вход по паролю. */
export const locked = ref(false);
export const chatOpen = ref(false);
/** Открытый тред чата (dir); null — список. Переживает закрытие панели и попадает в адрес (карточка 072). */
export const activeThread = ref<string | null>(null);

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

// --- фильтры и поиск (карточка 044) ---

export const filters = reactive({
  query: '',
  project: '',
  label: '',
  priorities: [] as number[],
  locked: false,
  waiting: false,
});
/** Карточки, у которых запрос найден в тексте постановки (ищет сервер); имя папки → совпадение. */
export const bodyHits = ref<Set<string>>(new Set());

export function resetFilters(): void {
  filters.query = '';
  filters.project = '';
  filters.label = '';
  filters.priorities = [];
  filters.locked = false;
  filters.waiting = false;
}

export const filterActive = computed(
  () =>
    filters.query.trim() !== '' ||
    filters.project !== '' ||
    filters.label !== '' ||
    filters.priorities.length > 0 ||
    filters.locked ||
    filters.waiting,
);

/** Видна ли карточка при текущих фильтрах. */
export function cardMatches(c: CardSummary): boolean {
  if (filters.project !== '' && c.project !== filters.project) return false;
  if (filters.label !== '' && !c.labels.includes(filters.label)) return false;
  if (filters.priorities.length > 0 && !filters.priorities.includes(c.priority)) return false;
  if (filters.locked && c.lockedBy === null) return false;
  if (filters.waiting && !state.value?.questions.some((q) => q.card === c.id && q.lastFrom === 'agent')) {
    return false;
  }
  const query = filters.query.trim().toLowerCase();
  if (query === '') return true;
  const haystack = `${c.title}\n${c.id}\n${c.name}\n${projectName(c.project)}`.toLowerCase();
  return haystack.includes(query) || bodyHits.value.has(c.name);
}

export const visibleCount = computed(() => state.value?.cards.filter(cardMatches).length ?? 0);

// текст постановки ищет сервер: запрос → карточки, у которых он есть в README (с задержкой на набор)
let searchTimer: ReturnType<typeof setTimeout> | undefined;
// номер текущего запроса: ответ на прежний запрос не должен затирать новый (большая доска, туннель)
let searchSeq = 0;
watch(
  () => filters.query,
  (query) => {
    if (searchTimer !== undefined) clearTimeout(searchTimer);
    const seq = ++searchSeq;
    bodyHits.value = new Set(); // под новым запросом не висят совпадения прежнего
    const q = query.trim();
    if (q.length < 2) return;
    searchTimer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) return;
        const names = ((await response.json()) as { names: string[] }).names;
        if (seq === searchSeq) bodyHits.value = new Set(names);
      } catch {
        /* поиск по тексту недоступен — остаётся поиск по названию */
      }
    }, 200);
  },
);
