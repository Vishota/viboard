<script setup lang="ts">
// Карточка 047: где доска, какая папка default, перенос в другую папку.
import { computed, inject, ref } from 'vue';
import { api } from '../api';
import { MODAL_ID, closeModal, confirmDialog, toast } from '../modal';
import { state, sync } from '../store';
import ModalShell from './ModalShell.vue';

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
  void run(api.boardDefault(), () => toast('This board is now the default', 'ok'));
}

async function move(force: boolean): Promise<void> {
  const path = target.value.trim();
  if (path === '') {
    error.value = 'Enter the new folder';
    return;
  }
  const ok = await confirmDialog({
    title: 'Move the board',
    message: `The board moves to ${path}. Agents working on it now read files from the old folder — stop them first.`,
    confirmLabel: 'Move',
  });
  if (!ok) return;
  await run(api.boardMigrate(path, force), (result) => {
    closeModal(modalId);
    toast(`Board moved to ${result.to}`, 'ok');
    for (const file of result.leftBehind) toast(`Left behind, open in another program: ${file}`);
  });
}
</script>

<template>
  <ModalShell @close="closeModal(modalId)">
    <h3>Board</h3>
    <div v-if="info" class="board-facts">
      <span>Folder</span>
      <code>{{ info.path }}</code>
      <span>Default</span>
      <code>{{ info.defaultPath }}</code>
    </div>
    <p v-if="info && !info.isDefault" class="board-hint">
      «viboard» without arguments opens the default folder, not this one.
    </p>
    <button v-if="info && !info.isDefault" type="button" class="btn-sec" :disabled="busy" @click="makeDefault">
      Use this board as the default
    </button>

    <h4 class="agent-heading">Move to another folder</h4>
    <div class="row">
      <input v-model="target" name="board-path" placeholder="C:\boards\my-board" :disabled="busy" />
      <button type="button" class="btn-sec" :disabled="busy" @click="move(false)">Move</button>
    </div>
    <button v-if="lockRefused" type="button" class="btn-danger" :disabled="busy" @click="move(true)">
      Move anyway — working agents keep reading the old folder
    </button>
    <p v-if="error !== ''" class="form-error">{{ error }}</p>
  </ModalShell>
</template>
