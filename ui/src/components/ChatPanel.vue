<script setup lang="ts">
import { computed, ref } from 'vue';
import type { Thread } from '@core/types';
import { attachmentName, formatDateTime, preview, stampMs } from '../format';
import { cardTitle, chatOpen, state } from '../store';
import ThreadView from './ThreadView.vue';
import { t } from '../i18n';

/** Открытый тред; null — список. Живёт в панели и переживает закрытие чата. */
const active = ref<string | null>(null);

const questions = computed(() => state.value?.questions ?? []);
const thread = computed(() => questions.value.find((t) => t.dir === active.value) ?? null);

/** Последнее сообщение треда одной строкой — для списка. */
function lastLine(t: Thread): string {
  const last = t.messages.at(-1);
  if (!last) return '';
  return last.attachment === null ? preview(last.body) : `📎 ${attachmentName(last.attachment)}`;
}

const title = (thread: Thread): string => (thread.card === '' ? t('Question') : cardTitle(thread.card));
</script>

<template>
  <aside class="chat" :class="{ open: chatOpen }" :aria-hidden="!chatOpen">
    <template v-if="chatOpen">
      <ThreadView v-if="thread" :thread="thread" @back="active = null" @close="chatOpen = false" />
      <template v-else>
        <header class="chat-head">
          <h2>{{ t('Chat') }}</h2>
          <button type="button" class="icon-btn" :title="t('Close')" @click="chatOpen = false">✕</button>
        </header>
        <div class="chat-list">
          <p v-if="questions.length === 0" class="empty chat-empty">{{ t('No messages') }}</p>
          <button v-for="t in questions" :key="t.dir" type="button" class="thread-row" @click="active = t.dir">
            <span class="dot" :class="{ unread: t.lastFrom === 'agent' }"></span>
            <span class="thread-main">
              <span class="thread-top">
                <b>{{ title(t) }}</b>
                <time>{{ formatDateTime(stampMs(t.created)) }}</time>
              </span>
              <span class="thread-preview">{{ lastLine(t) }}</span>
            </span>
          </button>
        </div>
      </template>
    </template>
  </aside>
</template>
