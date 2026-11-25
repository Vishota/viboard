// Карточка 072: что открыто — видно в адресе, и ссылка открывает то же самое.
// ?card=<имя> · ?thread=<тред>&chat=1 · ?agent · ?board · ?help · ?task — стек окон по порядку.

import { watch } from 'vue';
import AgentModal from './components/AgentModal.vue';
import BoardModal from './components/BoardModal.vue';
import CardModal from './components/CardModal.vue';
import HelpModal from './components/HelpModal.vue';
import TaskModal from './components/TaskModal.vue';
import type { Component } from 'vue';
import { closeModal, modals, openModal } from './modal';
import { activeThread, chatOpen } from './store';

interface Opening {
  key: string;
  component: Component;
  /** Значение в адресе для окна с параметром (у карточки — имя папки). */
  value?: (props: Record<string, unknown>) => string | undefined;
}

/** Порядок восстановления: так же, как их открывали бы рукой. */
const OPENINGS: readonly Opening[] = [
  { key: 'agent', component: AgentModal },
  { key: 'board', component: BoardModal },
  { key: 'help', component: HelpModal },
  { key: 'task', component: TaskModal },
  { key: 'card', component: CardModal, value: (props) => (typeof props.name === 'string' ? props.name : undefined) },
];

const find = (component: Component): Opening | undefined => OPENINGS.find((o) => o.component === component);

/** Адрес по текущему состоянию: окна в порядке стека, затем чат. */
export function queryNow(): URLSearchParams {
  const params = new URLSearchParams();
  for (const item of modals) {
    const opening = find(item.component);
    if (opening === undefined) continue;
    const value = opening.value?.(item.props);
    params.set(opening.key, value === undefined ? '1' : value);
  }
  if (chatOpen.value) params.set('chat', '1');
  if (activeThread.value !== null) params.set('thread', activeThread.value);
  return params;
}

/** Открыть то, что записано в адресе. Вызывается один раз при старте. */
export function restoreFromUrl(): void {
  const params = new URLSearchParams(window.location.search);
  chatOpen.value = params.get('chat') === '1';
  activeThread.value = params.get('thread');
  while (modals.length > 0) closeModal(); // справка первого входа открывается после этого и не затирает ссылку
  for (const opening of OPENINGS) {
    const value = params.get(opening.key);
    if (value === null) continue;
    const props = opening.value === undefined ? {} : { name: value };
    if (opening.value !== undefined && value === '1') continue; // карточка без имени — не открываем
    openModal(opening.component, props);
  }
}

/** Адрес меняется вместе с окнами и чатом (без записей в истории: Back не листает окна). */
export function startUrlSync(): void {
  const write = (): void => {
    const query = queryNow().toString();
    const url = query === '' ? window.location.pathname : `${window.location.pathname}?${query}`;
    if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, '', url);
  };
  watch(() => modals.map((m) => `${find(m.component)?.key ?? ''}:${JSON.stringify(m.props)}`), write);
  watch([chatOpen, activeThread], write);
  write();
}
