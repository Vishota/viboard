<script setup lang="ts">
// Удалённый доступ (UD-55), сторона владельца: одно окно с переключателем —
// «Дать доступ с другого устройства» / «Подключиться к другому устройству».
import { computed, inject, onBeforeUnmount, onMounted, ref } from 'vue';
import type { AccessState } from '@core/types';
import { api } from '../api';
import { formatDateTime } from '../format';
import { MODAL_ID, closeModal, copyText, toast } from '../modal';
import { t } from '../i18n';
import ModalShell from './ModalShell.vue';
import QrCode from './QrCode.vue';

const modalId = inject(MODAL_ID);

/** Публичный домен relay владельца: по коду «имя/ключ» ссылка собирается здесь. */
const TUNNEL_DOMAIN = 'run.vishota.com';
const SAVED = 'viboard.remoteDevices';

const tab = ref<'share' | 'connect'>('share');
const state = ref<AccessState | null>(null);
const busy = ref(false);
const error = ref('');
const now = ref(Date.now());

async function run(request: Promise<AccessState>, done?: string): Promise<void> {
  busy.value = true;
  error.value = '';
  try {
    state.value = await request;
    if (done) toast(done, 'ok');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}

const share = (): void => void run(api.accessOpen());
const stop = (): void => void run(api.accessClose(), t('Access is closed'));
const newKey = (): void => void run(api.accessKey());
const revoke = (id: string): void => void run(api.accessRevoke(id), t('Device disconnected'));

async function copyLink(): Promise<void> {
  try {
    await copyText(pairLink.value ?? '');
    toast(t('Copied'), 'ok');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

/** Ссылка с ключом: имя туннеля — первая метка публичного адреса. */
const tunnelName = computed(() => {
  const url = state.value?.url;
  return url === null || url === undefined ? '' : (new URL(url).hostname.split('.')[0] ?? '');
});
const pairLink = computed(() => {
  const key = state.value?.key;
  const url = state.value?.url;
  return key && url ? `${url}/?pair=${key.value}` : null;
});
const secondsLeft = computed(() => {
  const expiresAt = state.value?.key?.expiresAt;
  return expiresAt === undefined ? 0 : Math.max(0, Math.ceil((expiresAt - now.value) / 1000));
});
const keyAlive = computed(() => state.value?.key !== null && state.value?.key !== undefined && secondsLeft.value > 0);

// --- «Подключиться к другому устройству» ---
const code = ref('');
const saved = ref<{ name: string; url: string }[]>(readSaved());

function readSaved(): { name: string; url: string }[] {
  try {
    const list = JSON.parse(localStorage.getItem(SAVED) ?? '[]') as { name: string; url: string }[];
    return Array.isArray(list) ? list.filter((d) => typeof d.url === 'string') : [];
  } catch {
    return [];
  }
}
function writeSaved(): void {
  try {
    localStorage.setItem(SAVED, JSON.stringify(saved.value));
  } catch {
    /* без запоминания тоже работает */
  }
}

/** «имя/ключ» или ссылка → ссылка для подключения. */
function targetOf(input: string): string | null {
  const value = input.trim();
  if (/^https?:\/\/\S+$/iu.test(value)) return value;
  const code = /^([a-z0-9][a-z0-9-]*)\/([a-hjkmnp-z23456789]{6})$/iu.exec(value.replace(/\s+/gu, ''));
  if (code?.[1] && code[2]) return `https://${code[1].toLowerCase()}.${TUNNEL_DOMAIN}/?pair=${code[2].toLowerCase()}`;
  return null;
}

function connect(): void {
  const target = targetOf(code.value);
  if (target === null) {
    error.value = t('Enter the code as «name/key» or paste the link');
    return;
  }
  error.value = '';
  const url = new URL(target);
  const name = url.hostname.split('.')[0] ?? target;
  // запоминаем адрес без ключа: после подключения устройство узнаёт по своей сессии
  const base = url.origin + url.pathname;
  saved.value = [{ name, url: base }, ...saved.value.filter((device) => device.url !== base)];
  writeSaved();
  window.open(target, '_blank', 'noopener');
}
function forget(url: string): void {
  saved.value = saved.value.filter((d) => d.url !== url);
  writeSaved();
}

let clock: ReturnType<typeof setInterval> | undefined;
let poll: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void run(api.access());
  clock = setInterval(() => (now.value = Date.now()), 1000);
  // состояние живое: ключ гаснет, туннель может упасть, устройства подключаются
  poll = setInterval(
    () =>
      void api
        .access()
        .then((fresh) => (state.value = fresh))
        .catch(() => undefined),
    3000,
  );
});
onBeforeUnmount(() => {
  if (clock !== undefined) clearInterval(clock);
  if (poll !== undefined) clearInterval(poll);
});
</script>

<template>
  <ModalShell @close="closeModal(modalId)">
    <h3>{{ t('Remote access') }}</h3>

    <div class="access-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'share'"
        :class="{ on: tab === 'share' }"
        @click="tab = 'share'"
      >
        {{ t('Share access with another device') }}
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'connect'"
        :class="{ on: tab === 'connect' }"
        @click="tab = 'connect'"
      >
        {{ t('Connect to another device') }}
      </button>
    </div>

    <template v-if="tab === 'share'">
      <!-- предупреждение видно до нажатия: решение открыть доступ — осознанное -->
      <p v-if="state && state.tool.state !== 'missing'" class="board-hint access-warning">
        {{
          t(
            'Traffic: visitors connect to this computer directly when the network allows; otherwise everything goes through the virunx relay (run.vishota.com) in plain form. Do not share a board with secrets.',
          )
        }}
      </p>
      <p v-if="state && state.tool.state === 'missing'" class="board-hint">
        {{
          t(
            'The tunnel tool for this viboard version is not installed yet: virunx {version}, a small package from npm. It is put into the viboard settings folder and started only when you share access.',
            { version: state.toolVersion },
          )
        }}
      </p>
      <p v-else-if="state && !state.on" class="board-hint">
        {{
          t(
            'Open the board from a phone or another computer: the link appears here, with a QR code and a one-time key.',
          )
        }}
      </p>

      <div v-if="state && state.tool.state === 'missing'" class="row">
        <button type="button" class="btn" :disabled="busy" @click="run(api.accessInstall())">
          {{ t('Install') }}
        </button>
      </div>
      <div v-else-if="state && !state.on" class="row">
        <button type="button" class="btn" :disabled="busy" @click="share">{{ t('Share access') }}</button>
      </div>

      <template v-if="state && state.on">
        <p class="board-hint">
          {{ t('Scan the QR code with the phone camera or enter the code. The key works once.') }}
        </p>
        <div class="access-share">
          <QrCode v-if="keyAlive && pairLink" :text="pairLink" />
          <div class="access-share-text">
            <template v-if="keyAlive">
              <b class="access-code">{{ tunnelName }}/{{ state.key?.value }}</b>
              <span class="board-hint">{{ t('The key expires in {seconds} s', { seconds: secondsLeft }) }}</span>
            </template>
            <span v-else class="board-hint">{{
              t('The key has expired or is used — get a new one for the next device')
            }}</span>
            <div class="row">
              <button type="button" class="btn-sec" :disabled="busy" @click="newKey">
                {{ t('Key for one more device') }}
              </button>
              <button type="button" class="btn-sec" @click="copyLink">{{ t('Copy link') }}</button>
            </div>
            <code class="access-url">{{ state.url }}</code>
          </div>
        </div>
        <h4 class="agent-heading">{{ t('Connected devices') }}</h4>
        <p v-if="state.devices.length === 0" class="board-hint">{{ t('No devices yet') }}</p>
        <div v-for="device in state.devices" :key="device.id" class="access-device">
          <span>{{ device.name }}</span>
          <span class="board-hint">{{
            t('last seen {when}', { when: formatDateTime(Date.parse(device.lastSeenAt)) })
          }}</span>
          <button type="button" class="btn-sec btn-mini" :disabled="busy" @click="revoke(device.id)">
            {{ t('Revoke') }}
          </button>
        </div>
        <div class="row">
          <button type="button" class="btn-danger" :disabled="busy" @click="stop">{{ t('Stop sharing') }}</button>
        </div>
      </template>
    </template>

    <template v-else>
      <p class="board-hint">
        {{ t('Scan the QR code on the screen of another device with the phone camera, or enter the code from it.') }}
      </p>
      <form class="row" @submit.prevent="connect">
        <input
          v-model="code"
          name="access-code"
          spellcheck="false"
          autocomplete="off"
          :placeholder="t('name/key or link')"
        />
        <button type="submit" class="btn" :disabled="code.trim() === ''">{{ t('Connect to the board') }}</button>
      </form>
      <template v-if="saved.length > 0">
        <h4 class="agent-heading">{{ t('Saved devices') }}</h4>
        <div v-for="device in saved" :key="device.url" class="access-device">
          <a :href="device.url" target="_blank" rel="noopener">{{ device.name }}</a>
          <button type="button" class="btn-sec btn-mini" @click="forget(device.url)">{{ t('Forget') }}</button>
        </div>
      </template>
    </template>

    <p v-if="error !== ''" class="form-error">{{ error }}</p>
  </ModalShell>
</template>
