<script setup lang="ts">
// Карточка 048: что это и с чего начать — для того, кто открыл программу впервые.
import { inject, ref } from 'vue';
import { t } from '../i18n';
import { MODAL_ID, closeModal } from '../modal';
import { state } from '../store';
import ModalShell from './ModalShell.vue';

const modalId = inject(MODAL_ID);

const COLUMNS = [
  { name: 'backlog', text: 'not ready to be taken' },
  { name: 'todo', text: 'ready to be taken' },
  { name: 'doing', text: 'someone is working on it' },
  { name: 'blocked', text: 'waits for your answer in «Chat»' },
  { name: 'review', text: 'done, waits for verification' },
  { name: 'done', text: 'closed' },
] as const;

const STEPS = [
  { title: 'Create a task', text: 'Press «+ Task», fill in the title and the description.' },
  { title: 'Connect an agent', text: 'Open «Agent», copy the first line and paste it into the chat of your agent.' },
  {
    title: 'The agent picks the task up',
    text: 'It moves the card itself: todo → doing → review → done. Its questions appear in «Chat».',
  },
] as const;

const readMore = ref(false);
</script>

<template>
  <ModalShell @close="closeModal(modalId)">
    <h3>{{ t('How viboard works') }}</h3>
    <p class="help-text">
      {{
        t(
          'viboard is a task board that is a regular folder on your disk. You work in this window; an AI agent works with the same tasks as files.',
        )
      }}
    </p>

    <ol class="help-steps">
      <li v-for="step in STEPS" :key="step.title">
        <b>{{ t(step.title) }}</b>
        <span>{{ t(step.text) }}</span>
      </li>
    </ol>

    <button type="button" class="btn-sec" @click="readMore = !readMore">
      {{ readMore ? t('Hide the details') : t('Columns and files') }}
    </button>

    <template v-if="readMore">
      <h4 class="agent-heading">{{ t('Columns') }}</h4>
      <dl class="help-columns">
        <template v-for="column in COLUMNS" :key="column.name">
          <dt>{{ column.name }}</dt>
          <dd>{{ t(column.text) }}</dd>
        </template>
      </dl>
      <h4 class="agent-heading">{{ t('Where the files are') }}</h4>
      <p class="help-text">
        {{
          t('Everything you see here is in this folder. Open it in any file manager — the cards are ordinary files:')
        }}
        <code class="help-path">{{ state?.root }}</code>
      </p>
    </template>

    <div class="actions">
      <span class="grow" />
      <button type="button" class="btn" @click="closeModal(modalId)">{{ t('Got it') }}</button>
    </div>
  </ModalShell>
</template>
