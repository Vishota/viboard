<script setup lang="ts">
import ModalShell from './ModalShell.vue';
import { t } from '../i18n';

defineProps<{
  title: string;
  message: string;
  confirmLabel: string;
}>();

const emit = defineEmits<{ close: []; done: [value: boolean] }>();
</script>

<template>
  <ModalShell narrow @close="emit('close')">
    <h3>{{ title }}</h3>
    <p class="confirm-text">{{ message }}</p>
    <div class="actions">
      <span class="grow" />
      <button type="button" class="btn-sec" autofocus @click="emit('done', false)">{{ t('Cancel') }}</button>
      <button type="button" class="btn-danger" @click="emit('done', true)">{{ confirmLabel }}</button>
    </div>
  </ModalShell>
</template>
