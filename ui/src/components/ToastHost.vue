<script setup lang="ts">
import { dismissToast, toasts } from '../modal';
</script>

<template>
  <div class="toasts" role="status" aria-live="polite">
    <div v-for="item in toasts" :key="item.id" class="toast" :class="item.kind" @click="dismissToast(item.id)">
      {{ item.text }}
    </div>
  </div>
</template>
