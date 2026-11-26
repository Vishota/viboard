<script setup lang="ts">
import { onMounted, watch } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AuthGate from './components/AuthGate.vue';
import BoardView from './components/BoardView.vue';
import ChatPanel from './components/ChatPanel.vue';
import FilterBar from './components/FilterBar.vue';
import HelpModal from './components/HelpModal.vue';
import { openModal } from './modal';
import { t } from './i18n';
import ModalHost from './components/ModalHost.vue';
import PairGate from './components/PairGate.vue';
import ToastHost from './components/ToastHost.vue';
import { authKind, connection, locked, startPolling, state } from './store';
import { restoreFromUrl, startUrlSync } from './url';

// первый вход: один раз показать, что это и с чего начать (карточка 048) — когда доска впервые видна.
// Найдено вживую (UD-55): на устройстве, которое ещё не подключилось, справка владельца закрывала поле ключа.
const ONBOARDED = 'viboard.onboarded';
function openHelpOnce(): void {
  if (state.value === null) return;
  let seen = false;
  try {
    seen = localStorage.getItem(ONBOARDED) === '1';
  } catch {
    /* хранилище недоступно — окно покажется при каждом входе */
  }
  if (seen) return;
  openModal(HelpModal);
  try {
    localStorage.setItem(ONBOARDED, '1');
  } catch {
    /* без запоминания */
  }
}
onMounted(() => {
  startPolling();
  // карточка 072: сначала открываем то, что в адресе, затем адрес следует за окнами
  restoreFromUrl();
  startUrlSync();
  // доска уже видна — справка сейчас; иначе — когда впервые появится
  const stopHelp = watch(state, (board) => {
    if (board === null) return;
    stopHelp();
    openHelpOnce();
  });
  openHelpOnce();
});
</script>

<template>
  <div class="app">
    <AppHeader />
    <FilterBar v-if="state" />
    <main class="app-main">
      <BoardView v-if="state" />
      <PairGate v-else-if="locked && authKind === 'device'" />
      <AuthGate v-else-if="locked" />
      <p v-else-if="connection === 'offline'" class="app-status">{{ t('No connection to the board server') }}</p>
      <p v-else class="app-status">{{ t('Loading…') }}</p>
    </main>
    <ChatPanel />
    <!-- без доступа (пароль, устройство отозвали) окна доски не показываются -->
    <ModalHost v-if="!locked" />
    <ToastHost />
  </div>
</template>
