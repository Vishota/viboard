<script setup lang="ts">
import { computed, ref } from 'vue';
import { api } from '../api';
import { state, sync } from '../store';
import { t } from '../i18n';

/** Карточка в режиме правки; без неё — создание новой. */
const props = defineProps<{
  card?: { name: string; title: string; body: string; project: string; priority: number };
}>();
const emit = defineEmits<{ close: []; saved: [] }>();
const close = (): void => emit('close');

const LAST_PROJECT = 'viboard.lastProject';
const PRIORITIES = [1, 2, 3, 4, 5] as const;

const projects = computed(() => state.value?.projects ?? []);

function initialProject(): string {
  if (props.card) return props.card.project;
  let remembered: string | null = null;
  try {
    remembered = localStorage.getItem(LAST_PROJECT);
  } catch {
    /* хранилище недоступно — берём первый проект */
  }
  return projects.value.find((p) => p.id === remembered)?.id ?? projects.value[0]?.id ?? '';
}

const title = ref(props.card?.title ?? '');
const body = ref(props.card?.body ?? '');
const project = ref(initialProject());
const priority = ref(props.card?.priority ?? 3);

const addingProject = ref(false);
const projectName = ref('');
const projectPath = ref('');

const error = ref('');
const busy = ref(false);
const editing = computed(() => props.card !== undefined);

async function submit(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    let projectId = project.value;
    if (addingProject.value) {
      projectId = (await api.addProject({ name: projectName.value, path: projectPath.value })).project.id;
    }
    const fields = { title: title.value, body: body.value, project: projectId, priority: priority.value };
    if (props.card) await api.editCard({ name: props.card.name, ...fields });
    else await api.createCard(fields);
    try {
      localStorage.setItem(LAST_PROJECT, projectId);
    } catch {
      /* без запоминания проекта тоже работает */
    }
    await sync();
    emit('saved');
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <form class="card-form" @submit.prevent="submit">
    <div class="field">
      <label for="task-title">{{ t('Title') }}</label>
      <input id="task-title" v-model="title" name="title" required maxlength="200" autofocus />
    </div>
    <div class="field">
      <label for="task-project">{{ t('Project') }}</label>
      <div class="row">
        <select id="task-project" v-model="project" name="project" required :disabled="addingProject">
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <button type="button" class="btn-sec btn-mini" @click="addingProject = !addingProject">
          {{ addingProject ? t('Cancel') : t('New project') }}
        </button>
      </div>
    </div>
    <template v-if="addingProject">
      <div class="field">
        <label for="project-name">{{ t('Project name') }}</label>
        <input id="project-name" v-model="projectName" name="projectName" required />
      </div>
      <div class="field">
        <label for="project-path">{{ t('Project folder') }}</label>
        <input id="project-path" v-model="projectPath" name="projectPath" :placeholder="t('C:\projects\my-app')" />
      </div>
    </template>
    <div class="field">
      <span>{{ t('Priority') }}</span>
      <div class="segment">
        <label v-for="n in PRIORITIES" :key="n">
          <input v-model="priority" type="radio" name="priority" :value="n" />
          <span>{{ n }}</span>
        </label>
      </div>
    </div>
    <div class="field">
      <label for="task-body">{{ t('Description') }}</label>
      <textarea id="task-body" v-model="body" name="body" required rows="7"></textarea>
    </div>
    <p v-if="error !== ''" class="form-error">{{ error }}</p>
    <div class="actions">
      <span class="grow" />
      <button type="button" class="btn-sec" @click="close">{{ t('Cancel') }}</button>
      <button type="submit" class="btn" :disabled="busy">{{ editing ? t('Save') : t('Create') }}</button>
    </div>
  </form>
</template>
