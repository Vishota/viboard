<script setup lang="ts">
import { inject, ref } from 'vue';
import { api } from '../api';
import { MODAL_ID, closeModal } from '../modal';
import { sync } from '../store';
import ModalShell from './ModalShell.vue';

const modalId = inject(MODAL_ID);
const name = ref('');
const error = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api.addColumn(name.value.trim());
    await sync();
    closeModal(modalId);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ModalShell narrow>
    <h3>New column</h3>
    <form @submit.prevent="submit">
      <div class="field">
        <label for="column-name">Name</label>
        <input id="column-name" v-model="name" name="column" required autofocus />
      </div>
      <p v-if="error !== ''" class="form-error">{{ error }}</p>
      <div class="actions">
        <span class="grow" />
        <button type="button" class="btn-sec" @click="closeModal(modalId)">Cancel</button>
        <button type="submit" class="btn" :disabled="busy">Create</button>
      </div>
    </form>
  </ModalShell>
</template>
