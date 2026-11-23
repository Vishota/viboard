<script setup lang="ts">
import { computed } from 'vue';
import type { Message } from '@core/types';
import { chatAssetUrl } from '../api';
import { attachmentName, formatTime, isImage } from '../format';
import { renderMarkdown } from '../markdown';

/** Пузырь чата. `text` подменяет тело (у первого сообщения агента варианты уходят в кнопки). */
const props = defineProps<{ message: Message; thread: string; text?: string }>();

const html = computed(() => renderMarkdown(props.text ?? props.message.body));
const file = computed(() => props.message.attachment);
const image = computed(() => file.value !== null && isImage(file.value));
const url = computed(() => chatAssetUrl({ q: props.thread, f: file.value ?? '' }));
const time = computed(() => (props.message.time === null ? '' : formatTime(props.message.time)));
</script>

<template>
  <div v-if="file !== null" class="msg" :class="message.side">
    <a v-if="image" :href="url" target="_blank" rel="noopener">
      <img :src="url" :alt="attachmentName(file)" loading="lazy" />
    </a>
    <a v-else :href="url">📎 {{ attachmentName(file) }}</a>
  </div>
  <div v-else-if="message.side === 'user'" class="msg user">{{ message.body }}</div>
  <!-- Текст агента: renderMarkdown экранирует всё, разметка строится поверх. -->
  <div v-else class="msg agent">
    <div class="msg-line">agent · {{ message.session }}{{ time === '' ? '' : ` · ${time}` }}</div>
    <div class="md" v-html="html"></div>
  </div>
</template>
