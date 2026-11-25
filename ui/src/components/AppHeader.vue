<script setup lang="ts">
import AgentModal from './AgentModal.vue';
import BoardModal from './BoardModal.vue';
import TaskModal from './TaskModal.vue';
import { openModal } from '../modal';
import { chatOpen, state, unreadCount } from '../store';
</script>

<template>
  <header class="header">
    <!-- Имя — ссылка на оригинал: лицензия требует указывать исходный репозиторий (UD-33) -->
    <a class="brand" href="https://github.com/Vishota/viboard" target="_blank" rel="noopener">viboard</a>
    <span v-if="state" class="header-path" :title="state.root">{{ state.root }}</span>
    <span class="grow" />
    <!-- Действия — только на открытой доске: до входа по паролю они ничего не могут -->
    <template v-if="state">
      <button type="button" class="btn" @click="openModal(TaskModal)">+ Task</button>
      <button type="button" class="btn-sec" @click="openModal(AgentModal)">Agent</button>
      <button type="button" class="btn-sec" @click="openModal(BoardModal)">Board</button>
      <button type="button" class="btn-sec" @click="chatOpen = !chatOpen">
        <span>Chat</span>
        <span v-if="unreadCount > 0 && !chatOpen" class="badge">{{ unreadCount }}</span>
      </button>
    </template>
  </header>
</template>
