<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { closeModal, modals, type ModalItem } from '../modal';
import ModalFrame from './ModalFrame.vue';

/** Esc закрывает только верхнее окно — обработчик один на весь стек. */
function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape' && modals.length > 0) {
    event.preventDefault();
    closeModal();
  }
}

/** onClose — продолжение после закрытия (например, вернуться к просмотру карточки). */
function onClose(item: ModalItem): void {
  closeModal(item.id);
  const after = item.props.onClose;
  if (typeof after === 'function') (after as () => void)();
}

/** done — ответ диалога тому, кто его открыл (см. confirmDialog). */
function onDone(item: ModalItem, value: unknown): void {
  const answer = item.props.onDone;
  if (typeof answer === 'function') (answer as (v: unknown) => void)(value);
  closeModal(item.id);
}

onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
  <ModalFrame
    v-for="item in modals"
    :key="item.id"
    :item="item"
    @close="onClose(item)"
    @done="(value: unknown) => onDone(item, value)"
  />
</template>
