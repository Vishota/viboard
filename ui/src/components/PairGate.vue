<script setup lang="ts">
// Удалённый доступ (UD-55), сторона устройства: доска отвечает «нужна сессия устройства» — показываем
// поле для ключа с экрана владельца. Ссылка из QR (?pair=КЛЮЧ) подключает сама.
import { onMounted, ref } from 'vue';
import { t } from '../i18n';

const key = ref('');
const error = ref('');
const busy = ref(false);

async function pair(value: string): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const response = await fetch('/api/pair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: value }),
    });
    if (response.ok) {
      // ключ и следы ссылки из адреса убираем; сессия — в cookie
      location.replace(location.pathname);
      return;
    }
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    error.value =
      response.status === 429 ? t('Too many attempts — wait a minute') : t('The key is wrong or already used');
    void body.error;
  } catch {
    error.value = t('No connection to the board server');
  } finally {
    busy.value = false;
  }
}

onMounted(() => {
  const fromLink = new URLSearchParams(location.search).get('pair');
  if (fromLink !== null && fromLink !== '') void pair(fromLink);
});
</script>

<template>
  <main class="gate">
    <section class="gate-card">
      <h2>{{ t('Board of another device') }}</h2>
      <p>
        {{
          t(
            'Ask its owner for a key: «Remote access» → «Share access with another device». The key works once and for two minutes.',
          )
        }}
      </p>
      <form class="row" @submit.prevent="pair(key)">
        <input
          v-model="key"
          name="pair-key"
          autocomplete="off"
          spellcheck="false"
          :placeholder="t('key from the owner screen')"
          :disabled="busy"
          autofocus
        />
        <button type="submit" class="btn" :disabled="busy || key.trim() === ''">{{ t('Connect to the board') }}</button>
      </form>
      <p v-if="error !== ''" class="form-error">{{ error }}</p>
    </section>
  </main>
</template>
