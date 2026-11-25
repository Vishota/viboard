<script setup lang="ts">
import type { CardSummary } from '@core/types';
import { copyText, openModal, toast } from '../modal';
import { projectName } from '../store';
import CardModal from './CardModal.vue';
import { t } from '../i18n';

const props = defineProps<{ card: CardSummary }>();

function onDragStart(event: DragEvent): void {
  if (event.dataTransfer === null) return;
  event.dataTransfer.setData('text/plain', props.card.name);
  event.dataTransfer.effectAllowed = 'move';
}

async function copyId(): Promise<void> {
  try {
    await copyText(props.card.id);
    toast(t('Card id copied'), 'ok');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

function open(): void {
  openModal(CardModal, { name: props.card.name });
}
</script>

<template>
  <article
    class="card"
    :draggable="card.lockedBy === null"
    :title="card.lockedBy === null ? undefined : `lock-${card.lockedBy}`"
    @dragstart="onDragStart"
    @click="open"
  >
    <!-- Карточка 138: агенты и менеджер ссылаются на карточку по id — он виден и копируется кликом -->
    <button type="button" class="card-id" :title="t('Card id — click to copy')" @click.stop="copyId">
      {{ card.id }}
    </button>
    <span class="card-title">{{ card.title || t('Untitled') }}</span>
    <span class="chips">
      <span v-if="card.lockedBy !== null" class="chip chip-lock">lock-{{ card.lockedBy }}</span>
      <span class="chip">{{ projectName(card.project) }}</span>
      <span class="chip" :class="`chip-p${card.priority}`">P{{ card.priority }}</span>
    </span>
  </article>
</template>
