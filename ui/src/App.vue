<script setup lang="ts">
import { onMounted } from 'vue';
import AppHeader from './components/AppHeader.vue';
import AuthGate from './components/AuthGate.vue';
import BoardView from './components/BoardView.vue';
import ChatPanel from './components/ChatPanel.vue';
import FilterBar from './components/FilterBar.vue';
import ModalHost from './components/ModalHost.vue';
import ToastHost from './components/ToastHost.vue';
import { connection, locked, startPolling, state } from './store';

onMounted(startPolling);
</script>

<template>
  <div class="app">
    <AppHeader />
    <FilterBar />
    <main class="app-main">
      <BoardView v-if="state" />
      <AuthGate v-else-if="locked" />
      <p v-else-if="connection === 'offline'" class="app-status">No connection to the board server</p>
      <p v-else class="app-status">Loading…</p>
    </main>
    <ChatPanel />
    <ModalHost />
    <ToastHost />
  </div>
</template>
