<script setup lang="ts">
import BoardColumn from './BoardColumn.vue';
import ColumnModal from './ColumnModal.vue';
import { openModal } from '../modal';
import { state } from '../store';
</script>

<template>
  <div class="board">
    <BoardColumn v-for="column in state?.columns ?? []" :key="column" :column="column" />
    <button type="button" class="column-add" @click="openModal(ColumnModal)">+ column</button>
  </div>
</template>
