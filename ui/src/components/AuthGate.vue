<script setup lang="ts">
import { ref } from 'vue';
import { api } from '../api';
import { refresh } from '../store';

const password = ref('');
const error = ref('');
const busy = ref(false);

async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await api.login(password.value);
    await refresh();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="gate">
    <form class="gate-card" @submit.prevent="submit">
      <span class="brand">viboard</span>
      <div class="field">
        <label for="password">Password</label>
        <input id="password" v-model="password" type="password" name="password" required autofocus />
      </div>
      <p v-if="error !== ''" class="form-error">{{ error }}</p>
      <div class="actions">
        <span class="grow" />
        <button type="submit" class="btn" :disabled="busy">Sign in</button>
      </div>
    </form>
  </div>
</template>
