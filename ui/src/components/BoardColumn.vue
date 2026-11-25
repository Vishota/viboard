<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../api';
import { confirmDialog, toast } from '../modal';
import { cardMatches, filterActive, state, sync } from '../store';
import CardItem from './CardItem.vue';
import { t } from '../i18n';

const props = defineProps<{ column: string }>();

const over = ref(false);
const total = computed(() => state.value?.cards.filter((c) => c.column === props.column).length ?? 0);
const cards = computed(() => state.value?.cards.filter((c) => c.column === props.column && cardMatches(c)) ?? []);

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
    title: t('Delete column'),
    message: t('Column «{name}» is empty and will be deleted.', { name: props.column }),
    confirmLabel: t('Delete'),
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
      <span class="column-count"
        >{{ cards.length }}<template v-if="cards.length !== total">/{{ total }}</template></span
      >
      <button
        v-if="total === 0"
        type="button"
        class="icon-btn column-remove"
        :title="t('Delete column')"
        @click="remove"
      >
        ✕
      </button>
    </header>
    <CardItem v-for="card in cards" :key="card.id" :card="card" />
    <p v-if="cards.length === 0" class="empty">{{ filterActive && total > 0 ? t('no matches') : t('empty') }}</p>
  </section>
</template>
