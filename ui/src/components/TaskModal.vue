<script setup lang="ts">
import { inject } from 'vue';
import { MODAL_ID, closeModal } from '../modal';
import CardForm from './CardForm.vue';
import ModalShell from './ModalShell.vue';
import { t } from '../i18n';

const modalId = inject(MODAL_ID);
const close = (): void => closeModal(modalId);
</script>

<template>
  <ModalShell @close="close">
    <h3>{{ t('New task') }}</h3>
    <CardForm @close="close" @saved="close" />
  </ModalShell>
</template>
