<script setup lang="ts">
import { computed, inject, ref, watch } from 'vue';
import type { CardDetail, LogEntry } from '@core/types';
import { api, assetUrl } from '../api';
import { attachmentName, formatDateTime, formatSize, isImage, stampMs } from '../format';
import { renderMarkdown } from '../markdown';
import { MODAL_ID, closeModal, confirmDialog, copyText, toast } from '../modal';
import { projectName, state, sync } from '../store';
import CardForm from './CardForm.vue';
import ModalShell from './ModalShell.vue';

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [] }>();
const modalId = inject(MODAL_ID);

const detail = ref<CardDetail | null>(null);
const failure = ref('');
const fileInput = ref<HTMLInputElement | null>(null);

const summary = computed(() => state.value?.cards.find((c) => c.id === props.id));
/** Перечитывать, только когда карточка на доске что-то поменяла. */
const signature = computed(() => {
  const c = summary.value;
  return c ? `${c.name}|${c.column}|${c.priority}|${c.project}|${c.lockedBy ?? ''}|${c.log}|${c.assets}` : '';
});
const html = computed(() => renderMarkdown(detail.value?.card.body ?? ''));
const entryLabel = (entry: LogEntry): string =>
  entry.verdict === null ? entry.type : `${entry.type}/${entry.verdict}`;

async function load(): Promise<void> {
  if (!summary.value) {
    closeModal(modalId); // карточку удалили
    return;
  }
  try {
    detail.value = await api.card(props.id);
    failure.value = '';
  } catch (e) {
    failure.value = e instanceof Error ? e.message : String(e);
  }
}

watch(signature, () => void load(), { immediate: true });

async function run(request: Promise<unknown>, done?: () => void): Promise<void> {
  try {
    await request;
    await sync();
    done?.();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}

/** Правка — внутри этого же окна: форма сменяет просмотр и возвращается после сохранения. */
const editing = ref(false);

function edit(): void {
  if (detail.value) editing.value = true;
}

function saved(): void {
  editing.value = false;
}

function attach(event: Event): void {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  if (file.size > 20 * 1048576) {
    toast('File is larger than 20 MB');
    return;
  }
  void run(api.attachCard(props.id, file, file.name));
}

async function remove(): Promise<void> {
  const title = detail.value?.card.title ?? '';
  const ok = await confirmDialog({
    title: 'Delete card',
    message: `«${title}» will be deleted with its log and attachments. It can only be restored from git history.`,
    confirmLabel: 'Delete',
  });
  if (ok) void run(api.deleteCard(props.id), () => closeModal(modalId));
}

async function copyForAgent(): Promise<void> {
  try {
    const { prompt } = await api.prompt(props.id, 'executor');
    await copyText(prompt);
    toast('Briefing copied', 'ok');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
</script>

<template>
  <ModalShell @close="emit('close')">
    <CardForm
      v-if="editing && detail"
      :card="{
        id: detail.card.id,
        title: detail.card.title,
        body: detail.card.body,
        project: detail.card.project,
        priority: detail.card.priority,
      }"
      @close="editing = false"
      @saved="saved"
    />
    <template v-else-if="detail">
      <h2>{{ detail.card.title || 'Untitled' }}</h2>
      <p class="meta">
        {{ detail.card.name }} · {{ detail.card.column }}/ · {{ projectName(detail.card.project) }} · P{{
          detail.card.priority
        }}
        <template v-if="detail.card.lockedBy !== null">· lock-{{ detail.card.lockedBy }}</template>
      </p>
      <!-- Текст агентов и владельца: renderMarkdown экранирует всё, разметка строится поверх. -->
      <div class="md" v-html="html"></div>
      <div v-if="detail.card.assets.length > 0" class="assets">
        <template v-for="name in detail.card.assets" :key="name">
          <a v-if="isImage(name)" :href="assetUrl({ card: detail.card.id, f: name })" target="_blank" rel="noopener">
            <img :src="assetUrl({ card: detail.card.id, f: name })" :alt="name" loading="lazy" />
          </a>
          <a v-else :href="assetUrl({ card: detail.card.id, f: name })">
            {{ attachmentName(name) }}<span class="size">{{ formatSize(detail.assetSizes[name] ?? 0) }}</span>
          </a>
        </template>
      </div>
      <section v-if="detail.entries.length > 0" class="log">
        <h3>log</h3>
        <article v-for="entry in detail.entries" :key="entry.file" class="log-entry">
          <div class="log-when">
            {{ formatDateTime(stampMs(entry.time)) }} · {{ entryLabel(entry) }} · {{ entry.tag }}
          </div>
          <div class="log-text">{{ entry.text }}</div>
        </article>
      </section>
      <div class="actions">
        <button type="button" class="btn-sec" @click="edit">Edit</button>
        <button type="button" class="btn-sec" @click="fileInput?.click()">Attach file</button>
        <input ref="fileInput" type="file" hidden @change="attach" />
        <button type="button" class="btn-sec" @click="copyForAgent">Copy for agent</button>
        <span class="grow" />
        <button type="button" class="btn-danger" @click="remove">Delete</button>
      </div>
    </template>
    <p v-else-if="failure !== ''" class="form-error">{{ failure }}</p>
    <p v-else class="empty">Loading…</p>
  </ModalShell>
</template>
