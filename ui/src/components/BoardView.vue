<script setup lang="ts">
import BoardColumn from './BoardColumn.vue';
import ColumnModal from './ColumnModal.vue';
import { openModal } from '../modal';
import { state } from '../store';
import { t } from '../i18n';
</script>

<template>
  <div class="board">
    <BoardColumn v-for="column in state?.columns ?? []" :key="column" :column="column" />
    <button type="button" class="column-add" @click="openModal(ColumnModal)">{{ t('+ column') }}</button>
  </div>
</template>
