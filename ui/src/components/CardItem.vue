<script setup lang="ts">
import type { CardSummary } from '@core/types';
import { openModal } from '../modal';
import { projectName } from '../store';
import CardModal from './CardModal.vue';

const props = defineProps<{ card: CardSummary }>();

function onDragStart(event: DragEvent): void {
  if (event.dataTransfer === null) return;
  event.dataTransfer.setData('text/plain', props.card.id);
  event.dataTransfer.effectAllowed = 'move';
}

function open(): void {
  openModal(CardModal, { id: props.card.id });
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
    <span class="card-title">{{ card.title || 'Untitled' }}</span>
    <span class="chips">
      <span v-if="card.lockedBy !== null" class="chip chip-lock">lock-{{ card.lockedBy }}</span>
      <span class="chip">{{ projectName(card.project) }}</span>
      <span class="chip" :class="`chip-p${card.priority}`">P{{ card.priority }}</span>
    </span>
  </article>
</template>
