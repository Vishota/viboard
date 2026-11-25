<script setup lang="ts">
// Карточка 044: поиск и фильтры карточек — по тексту, проекту, приоритету, состоянию.
import { computed } from 'vue';
import { filterActive, filters, resetFilters, state, visibleCount } from '../store';

const PRIORITIES = [1, 2, 3, 4, 5] as const;

const projects = computed(() => state.value?.projects ?? []);
const total = computed(() => state.value?.cards.length ?? 0);

function togglePriority(n: number): void {
  filters.priorities = filters.priorities.includes(n)
    ? filters.priorities.filter((p) => p !== n)
    : [...filters.priorities, n].sort();
}
</script>

<template>
  <div class="filterbar">
    <input
      v-model="filters.query"
      class="filter-query"
      type="search"
      name="search"
      placeholder="Search"
      aria-label="Search"
    />
    <select v-model="filters.project" class="filter-project" aria-label="Project">
      <option value="">All projects</option>
      <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
    </select>
    <div class="filter-group" role="group" aria-label="Priority">
      <button
        v-for="n in PRIORITIES"
        :key="n"
        type="button"
        class="chip filter-priority"
        :class="[`chip-p${n}`, { on: filters.priorities.includes(n) }]"
        :aria-pressed="filters.priorities.includes(n)"
        @click="togglePriority(n)"
      >
        P{{ n }}
      </button>
    </div>
    <div class="filter-group">
      <button
        type="button"
        class="chip filter-toggle"
        :class="{ on: filters.locked }"
        :aria-pressed="filters.locked"
        @click="filters.locked = !filters.locked"
      >
        In progress
      </button>
      <button
        type="button"
        class="chip filter-toggle"
        :class="{ on: filters.waiting }"
        :aria-pressed="filters.waiting"
        @click="filters.waiting = !filters.waiting"
      >
        Waiting for you
      </button>
    </div>
    <span v-if="filterActive" class="filter-count">{{ visibleCount }} of {{ total }}</span>
    <button v-if="filterActive" type="button" class="icon-btn" title="Clear filters" @click="resetFilters()">✕</button>
  </div>
</template>
