<script lang="ts">
// Какое состояние синхронизации должно само привлечь внимание владельца.
const syncAlert = computed<'conflict' | 'error' | null>(() => {
  const sync = state.value?.sync;
  return sync?.state === 'conflict' || sync?.state === 'error' ? sync.state : null;
});
</script>
<script setup lang="ts">
import AgentModal from './AgentModal.vue';
import { computed } from 'vue';
import BoardModal from './BoardModal.vue';
import HelpModal from './HelpModal.vue';
import { locale, setLocale, locales } from '../i18n';
import TaskModal from './TaskModal.vue';
import { openModal } from '../modal';
import { chatOpen, state, unreadCount } from '../store';
import { t } from '../i18n';
</script>

<template>
  <header class="header">
    <!-- Имя — ссылка на оригинал: лицензия требует указывать исходный репозиторий (UD-33) -->
    <a class="brand" href="https://github.com/Vishota/viboard" target="_blank" rel="noopener">viboard</a>
    <span v-if="state" class="header-path" :title="state.root">{{ state.root }}</span>
    <span class="grow" />
    <div class="locale" role="group" :aria-label="t('Language')">
      <button
        v-for="item in locales"
        :key="item.id"
        type="button"
        class="locale-item"
        :class="{ on: locale === item.id }"
        :aria-pressed="locale === item.id"
        @click="setLocale(item.id)"
      >
        {{ item.label }}
      </button>
    </div>
    <button type="button" class="btn-sec" :title="t('How viboard works')" @click="openModal(HelpModal)">?</button>
    <!-- Действия — только на открытой доске: до входа по паролю они ничего не могут -->
    <template v-if="state">
      <button type="button" class="btn" @click="openModal(TaskModal)">{{ t('+ Task') }}</button>
      <button type="button" class="btn-sec" @click="openModal(AgentModal)">{{ t('Agent') }}</button>
      <!-- Карточка 049: конфликт или ошибка синхронизации видны без открытия окна Board -->
      <button
        v-if="syncAlert"
        type="button"
        class="btn-sec sync-alert"
        :title="t('Git sync needs your attention')"
        @click="openModal(BoardModal)"
      >
        {{ syncAlert === 'conflict' ? t('Sync conflict') : t('Sync failed') }}
      </button>
      <button type="button" class="btn-sec" @click="openModal(BoardModal)">{{ t('Board') }}</button>
      <button type="button" class="btn-sec" @click="chatOpen = !chatOpen">
        <span>{{ t('Chat') }}</span>
        <span v-if="unreadCount > 0 && !chatOpen" class="badge">{{ unreadCount }}</span>
      </button>
    </template>
  </header>
</template>
