<script setup lang="ts">
// Карточка 047: где доска, какая папка default, перенос в другую папку.
import { computed, inject, ref } from 'vue';
import { api } from '../api';
import { MODAL_ID, closeModal, confirmDialog, toast } from '../modal';
import { state, sync } from '../store';
import ModalShell from './ModalShell.vue';
import SyncPanel from './SyncPanel.vue';
import { t } from '../i18n';

const modalId = inject(MODAL_ID);

const info = computed(() => state.value?.board);
const target = ref('');
const error = ref('');
const busy = ref(false);
/** Сервер отказал из-за замков: предлагаем перенос силой — с честным предупреждением. */
const lockRefused = ref(false);

async function run<T>(request: Promise<T>, done?: (result: T) => void): Promise<void> {
  busy.value = true;
  error.value = '';
  lockRefused.value = false;
  try {
    const result = await request;
    await sync();
    done?.(result);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    lockRefused.value = error.value.includes('agents are working');
  } finally {
    busy.value = false;
  }
}

function makeDefault(): void {
  void run(api.boardDefault(), () => toast(t('This board is now the default'), 'ok'));
}

async function move(force: boolean): Promise<void> {
  const path = target.value.trim();
  if (path === '') {
    error.value = t('Enter the new folder');
    return;
  }
  const ok = await confirmDialog({
    title: t('Move the board'),
    message: t(
      'The board moves to {path}. Agents working on it now read files from the old folder — stop them first.',
      { path },
    ),
    confirmLabel: t('Move'),
  });
  if (!ok) return;
  await run(api.boardMigrate(path, force), (result) => {
    closeModal(modalId);
    toast(t('Board moved to {path}', { path: result.to }), 'ok');
    for (const file of result.leftBehind) toast(t('Left behind, open in another program: {file}', { file }));
  });
}
</script>

<template>
  <ModalShell @close="closeModal(modalId)">
    <h3>{{ t('Board') }}</h3>
    <div v-if="info" class="board-facts">
      <span>{{ t('Folder') }}</span>
      <code>{{ info.path }}</code>
      <span>{{ t('Default') }}</span>
      <code>{{ info.defaultPath }}</code>
    </div>
    <p v-if="info && !info.isDefault" class="board-hint">
      {{ t('«viboard» without arguments opens the default folder, not this one.') }}
    </p>
    <button v-if="info && !info.isDefault" type="button" class="btn-sec" :disabled="busy" @click="makeDefault">
      {{ t('Use this board as the default') }}
    </button>

    <h4 class="agent-heading">{{ t('Move to another folder') }}</h4>
    <div class="row">
      <input v-model="target" name="board-path" placeholder="C:\boards\my-board" :disabled="busy" />
      <button type="button" class="btn-sec" :disabled="busy" @click="move(false)">{{ t('Move') }}</button>
    </div>
    <button v-if="lockRefused" type="button" class="btn-danger" :disabled="busy" @click="move(true)">
      {{ t('Move anyway — working agents keep reading the old folder') }}
    </button>
    <p v-if="error !== ''" class="form-error">{{ error }}</p>
    <SyncPanel />
  </ModalShell>
</template>
