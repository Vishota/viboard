<script setup lang="ts">
import { onMounted } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AuthGate from './components/AuthGate.vue';
import BoardView from './components/BoardView.vue';
import ChatPanel from './components/ChatPanel.vue';
import FilterBar from './components/FilterBar.vue';
import HelpModal from './components/HelpModal.vue';
import { openModal } from './modal';
import { t } from './i18n';
import ModalHost from './components/ModalHost.vue';
import ToastHost from './components/ToastHost.vue';
import { connection, locked, startPolling, state } from './store';

// первый вход: один раз показать, что это и с чего начать (карточка 048)
const ONBOARDED = 'viboard.onboarded';
onMounted(() => {
  startPolling();
  let seen = false;
  try {
    seen = localStorage.getItem(ONBOARDED) === '1';
  } catch {
    /* хранилище недоступно — окно покажется при каждом входе */
  }
  if (!seen) {
    openModal(HelpModal);
    try {
      localStorage.setItem(ONBOARDED, '1');
    } catch {
      /* без запоминания */
    }
  }
});
</script>

<template>
  <div class="app">
    <AppHeader />
    <FilterBar v-if="state" />
    <main class="app-main">
      <BoardView v-if="state" />
      <AuthGate v-else-if="locked" />
      <p v-else-if="connection === 'offline'" class="app-status">{{ t('No connection to the board server') }}</p>
      <p v-else class="app-status">{{ t('Loading…') }}</p>
    </main>
    <ChatPanel />
    <ModalHost />
    <ToastHost />
  </div>
</template>
