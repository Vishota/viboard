<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../api';
import { confirmDialog, toast } from '../modal';
import { state, sync } from '../store';
import CardItem from './CardItem.vue';

const props = defineProps<{ column: string }>();

const over = ref(false);
const cards = computed(() => state.value?.cards.filter((c) => c.column === props.column) ?? []);

async function run(request: Promise<unknown>): Promise<void> {
  try {
    await request;
    await sync();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

function onDrop(event: DragEvent): void {
  over.value = false;
  const id = event.dataTransfer?.getData('text/plain') ?? '';
  if (id !== '') void run(api.moveCard(id, props.column));
}

async function remove(): Promise<void> {
  const ok = await confirmDialog({
    title: 'Delete column',
    message: `Column «${props.column}» is empty and will be deleted.`,
    confirmLabel: 'Delete',
  });
  if (ok) void run(api.deleteColumn(props.column));
}
</script>

<template>
  <section
    class="column"
    :class="{ over }"
    @dragover.prevent="over = true"
    @dragleave="over = false"
    @drop.prevent="onDrop"
  >
    <header class="column-head">
      <h2>{{ column }}</h2>
      <span class="column-count">{{ cards.length }}</span>
      <button
        v-if="cards.length === 0"
        type="button"
        class="icon-btn column-remove"
        title="Delete column"
        @click="remove"
      >
        ✕
      </button>
    </header>
    <CardItem v-for="card in cards" :key="card.id" :card="card" />
    <p v-if="cards.length === 0" class="empty">empty</p>
  </section>
</template>
