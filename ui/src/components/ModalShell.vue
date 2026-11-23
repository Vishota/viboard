<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

/** Оболочка модального окна: подложка, фокус на первый элемент с autofocus. Esc обрабатывает ModalHost. */
withDefaults(defineProps<{ narrow?: boolean }>(), { narrow: false });

const emit = defineEmits<{ close: [] }>();
const panel = ref<HTMLElement | null>(null);

function onBackdrop(event: MouseEvent): void {
  if (event.target === event.currentTarget) emit('close');
}

onMounted(() => {
  (panel.value?.querySelector<HTMLElement>('[autofocus]') ?? panel.value)?.focus();
});

onBeforeUnmount(() => {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
});
</script>

<template>
  <div class="overlay" @mousedown="onBackdrop">
    <div ref="panel" class="modal" :class="{ 'modal-narrow': narrow }" tabindex="-1" role="dialog" aria-modal="true">
      <button type="button" class="icon-btn modal-close" title="Close" @click="emit('close')">✕</button>
      <slot />
    </div>
  </div>
</template>
