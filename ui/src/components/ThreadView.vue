<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { Thread } from '@core/types';
import { api } from '../api';
import { draftOf, saveDraft } from '../drafts';
import { cardTitle, state, sync } from '../store';
import { openModal, toast } from '../modal';
import CardModal from './CardModal.vue';
import MessageBubble from './MessageBubble.vue';
import { t } from '../i18n';

const props = defineProps<{ thread: Thread }>();
const emit = defineEmits<{ back: []; close: [] }>();

const MAX_FILE = 20 * 1048576;
/** Раздел вариантов: `## Options` (протокол) и `## Варианты` (доски, начатые на русском протоколе). */
const VARIANTS = ['## Options', '## Варианты'];

// Карточка 154: поле открывается пустым; набранный текст сохраняется по мере ввода и возвращается
// незаметной ссылкой «восстановить черновик» — молча подставлять его в поле нельзя.
const saved = ref(draftOf(props.thread.dir));
const draft = ref('');
watch(draft, (value) => {
  saveDraft(props.thread.dir, value);
  saved.value = value;
});
/** Ссылка видна, только когда есть сохранённый текст, а поле пустое. */
const canRestore = computed(() => saved.value.trim() !== '' && draft.value === '');
function restoreDraft(): void {
  draft.value = saved.value;
  input.value?.focus();
}

const busy = ref(false);
const list = ref<HTMLElement | null>(null);
const input = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);

const first = computed(() => props.thread.messages[0]?.body ?? '');
/** Карточка 057: из ветки — в её карточку. */
const card = computed(() => state.value?.cards.find((c) => c.id === props.thread.card));
function openCard(): void {
  if (card.value) openModal(CardModal, { name: card.value.name });
}
const variantsAt = computed(() => {
  const found = VARIANTS.map((marker) => first.value.indexOf(marker)).filter((at) => at >= 0);
  return found.length > 0 ? Math.min(...found) : -1;
});
/** Первое сообщение без раздела вариантов — они показываются кнопками. */
const intro = computed(() => (variantsAt.value < 0 ? first.value : first.value.slice(0, variantsAt.value).trim()));
const variants = computed(() =>
  variantsAt.value < 0
    ? []
    : first.value
        .slice(variantsAt.value)
        .split('\n')
        .filter((line) => line.startsWith('- '))
        // разметку варианта убираем: кнопка и ответ владельца читаются как текст (найдено вживую: «**A.** путь»)
        .map((line) => line.slice(2).trim().replaceAll('**', '')),
);
/** Быстрые ответы — до первого ответа владельца, как в первом сообщении треда. */
const quick = computed(() => variants.value.length > 0 && !props.thread.answered);

const title = computed(() => (props.thread.card === '' ? t('Question') : cardTitle(props.thread.card)));

function scrollToEnd(): void {
  const el = list.value;
  if (el) el.scrollTop = el.scrollHeight;
}

/** Новые сообщения не проглатываются: список доскролливается, поле ввода не трогается. */
watch(
  () => props.thread.messages.length,
  async () => {
    await nextTick();
    scrollToEnd();
  },
  { immediate: true },
);

/** Высота поля — по тексту; через CSSOM, чтобы обойтись без встроенных стилей в разметке. */
function autosize(): void {
  const el = input.value;
  if (!el) return;
  el.style.height = '38px';
  el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
}

onMounted(() => {
  scrollToEnd();
  autosize();
  input.value?.focus();
});

async function send(text: string): Promise<void> {
  const value = text.trim();
  if (value === '' || busy.value) return;
  busy.value = true;
  try {
    await api.sendMessage(props.thread.dir, value);
    draft.value = '';
    await sync();
    await nextTick();
    scrollToEnd();
    autosize();
    input.value?.focus();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    void send(draft.value);
  }
}

async function attach(event: Event): Promise<void> {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  const file = target.files?.[0];
  target.value = '';
  if (!file || busy.value) return;
  if (file.size > MAX_FILE) {
    toast(t('File is larger than 20 MB'));
    return;
  }
  busy.value = true;
  try {
    await api.attachThread(props.thread.dir, file, file.name);
    await sync();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="chat-thread">
    <header class="chat-head">
      <button type="button" class="btn-sec btn-mini" :title="t('Back to list')" @click="emit('back')">‹</button>
      <h2>{{ title }}</h2>
      <button
        v-if="card"
        type="button"
        class="btn-sec btn-mini"
        :title="t('Open the card of this thread')"
        @click="openCard"
      >
        {{ t('Open card') }}
      </button>
      <button type="button" class="icon-btn" :title="t('Close')" @click="emit('close')">✕</button>
    </header>
    <div ref="list" class="msgs">
      <MessageBubble
        v-for="(message, index) in thread.messages"
        :key="index"
        :message="message"
        :thread="thread.dir"
        :text="index === 0 ? intro : undefined"
      />
    </div>
    <div v-if="quick" class="variants">
      <button v-for="variant in variants" :key="variant" type="button" class="btn-sec" @click="send(variant)">
        {{ variant }}
      </button>
    </div>
    <div v-if="canRestore" class="draft-restore">
      <button type="button" class="link-btn" @click="restoreDraft">{{ t('Restore draft') }}</button>
    </div>
    <div class="composer">
      <button type="button" class="icon-btn composer-attach" :title="t('Attach file')" @click="fileInput?.click()">
        📎
      </button>
      <input ref="fileInput" type="file" hidden @change="attach" />
      <textarea
        ref="input"
        v-model="draft"
        :placeholder="t('Message')"
        rows="1"
        @keydown="onKeydown"
        @input="autosize"
      ></textarea>
      <button type="button" class="btn" :disabled="busy" @click="send(draft)">{{ t('Send') }}</button>
    </div>
  </div>
</template>
