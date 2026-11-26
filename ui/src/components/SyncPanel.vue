<script setup lang="ts">
// Карточка 049: синхронизация доски через git — раздел окна Board.
import { computed, ref } from 'vue';
import type { SyncInfo, SyncState } from '@core/types';
import { api } from '../api';
import { copyText, toast } from '../modal';
import { state, sync } from '../store';
import { t } from '../i18n';

const info = computed<SyncInfo | undefined>(() => state.value?.sync);
const remote = ref('');
const busy = ref(false);
const error = ref('');

/** Текст конфликта присылает сервер по-английски — переводим здесь, как остальные подписи. */
const CONFLICT_HINT =
  'The same files changed on two devices. Nothing is lost: this device keeps its changes; they are not sent until the conflict is resolved.';

const STATE_TEXT: Record<SyncState, string> = {
  off: 'Sync is off',
  clean: 'Up to date',
  dirty: 'Not sent yet',
  conflict: 'Conflict',
  error: 'Sync failed',
};

async function run(request: Promise<unknown>, done?: string): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    const result = (await request) as Partial<SyncInfo>;
    await sync();
    // тост говорит правду: после попытки конфликт или ошибка могли остаться (найдено вживую)
    const after = result.state ?? state.value?.sync.state;
    if (after === 'conflict') toast(t('The conflict is still there'), 'error');
    else if (after === 'error') toast(result.message ?? t('Sync failed'), 'error');
    else if (done) toast(done, 'ok');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const connect = (): void => void run(api.sync({ remote: remote.value.trim() }), t('Remote repository connected'));

const toggle = (key: 'autoPull' | 'autoPush', event: Event): void =>
  void run(api.sync({ [key]: (event.target as HTMLInputElement).checked }));

const now = (): void => void run(api.sync({ action: 'now' }), t('Synced'));

/** Конфликт разрешает агент: одна строка для его чата. */
const conflictPrompt = computed(
  () =>
    `The task board in ${state.value?.root ?? ''} is a git repository. \`git pull --rebase\` there ends with a merge conflict. ` +
    `Resolve it keeping the changes of both devices, finish the pull and push. Read AGENTS.md in the board folder first.`,
);

async function copyPrompt(): Promise<void> {
  try {
    await copyText(conflictPrompt.value);
    toast(t('Copied'), 'ok');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
</script>

<template>
  <section v-if="info" class="sync">
    <h4 class="agent-heading">{{ t('Git sync') }}</h4>
    <p v-if="!info.available" class="board-hint">
      <!-- «папка не репозиторий» и «git не установлен» — разные случаи (возврат ревью по 049) -->
      <template v-if="info.reason === 'inside-repo'">{{
        t('The board lies inside another repository. Sync works only when the board folder is a repository of its own.')
      }}</template>
      <template v-else-if="info.reason === 'no-repo'">{{
        t('The board folder is not a git repository yet. Run git init in it to sync the board between devices.')
      }}</template>
      <template v-else>{{ t('Git is not installed. Install Git to sync this board between devices.') }}</template>
    </p>
    <template v-else>
      <p class="board-hint">
        {{
          t(
            'The board is a git repository: commit and push send your changes, pull brings the changes from another device.',
          )
        }}
      </p>
      <div class="board-facts">
        <span>{{ t('Remote') }}</span>
        <code>{{ info.remote || t('not connected') }}</code>
        <span>{{ t('Status') }}</span>
        <code :class="{ 'sync-bad': info.state === 'conflict' || info.state === 'error' }">
          {{ t(STATE_TEXT[info.state]) }}<template v-if="info.pending > 0"> · {{ info.pending }}</template>
        </code>
      </div>
      <form v-if="info.remote === ''" class="row" @submit.prevent="connect">
        <input v-model="remote" name="sync-remote" placeholder="https://github.com/you/board.git" :disabled="busy" />
        <button type="submit" class="btn-sec" :disabled="busy">{{ t('Connect') }}</button>
      </form>
      <div class="row sync-toggles">
        <label>
          <input type="checkbox" :checked="info.autoPull" :disabled="busy" @change="toggle('autoPull', $event)" />
          {{ t('Pull automatically') }}
        </label>
        <label>
          <input type="checkbox" :checked="info.autoPush" :disabled="busy" @change="toggle('autoPush', $event)" />
          {{ t('Commit and push automatically') }}
        </label>
      </div>
      <div class="row">
        <button type="button" class="btn-sec" :disabled="busy || info.remote === ''" @click="now">
          {{ t('Sync now') }}
        </button>
      </div>
      <div v-if="info.state === 'conflict'" class="sync-conflict">
        <p>{{ t(CONFLICT_HINT) }}</p>
        <button type="button" class="btn-sec" :disabled="busy" @click="copyPrompt">
          {{ t('Copy prompt for the agent') }}
        </button>
      </div>
      <p v-else-if="info.state === 'error'" class="form-error">{{ info.message }}</p>
    </template>
    <p v-if="error !== ''" class="form-error">{{ error }}</p>
  </section>
</template>
