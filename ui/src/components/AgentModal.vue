<script setup lang="ts">
import { computed, inject } from 'vue';
import type { Role } from '@core/types';
import { MODAL_ID, closeModal, copyText, toast } from '../modal';
import { state } from '../store';
import ModalShell from './ModalShell.vue';

const modalId = inject(MODAL_ID);

/** Роли и что делает сессия; полный текст задания свёрнут — его копируют, а не читают. */
const roles: ReadonlyArray<{ key: Role; label: string; hint: string }> = [
  { key: 'executor', label: 'Executor', hint: 'takes the top free card in todo/' },
  { key: 'reviewer', label: 'Reviewer', hint: 'verifies a card in review/ that has no verdict' },
  { key: 'manager', label: 'Manager', hint: 'a pass over the board: checklist, unblocking, commit' },
];

const prompts = computed(() => state.value?.prompts);

async function copy(text: string | undefined): Promise<void> {
  if (!text) return;
  try {
    await copyText(text);
    toast('Copied', 'ok');
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e));
  }
}
</script>

<template>
  <ModalShell @close="closeModal(modalId)">
    <h3>Agent</h3>
    <p class="meta">{{ state?.root }}</p>

    <h4 class="agent-heading">Connect an agent</h4>
    <div class="copy-block">
      <pre>{{ prompts?.board }}</pre>
      <button type="button" class="btn-sec btn-mini copy-btn" @click="copy(prompts?.board)">Copy</button>
    </div>

    <h4 class="agent-heading">Briefing for a new session</h4>
    <div v-for="role in roles" :key="role.key" class="agent-role">
      <div class="agent-role-head">
        <div class="agent-role-text">
          <span class="agent-role-name">{{ role.label }}</span>
          <span class="agent-role-hint">{{ role.hint }}</span>
        </div>
        <button type="button" class="btn-sec btn-mini" @click="copy(prompts?.[role.key])">Copy</button>
      </div>
      <details class="agent-text">
        <summary>Briefing text</summary>
        <pre>{{ prompts?.[role.key] }}</pre>
      </details>
    </div>
  </ModalShell>
</template>
