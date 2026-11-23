<script setup lang="ts">
import { provide } from 'vue';
import { MODAL_ID, type ModalItem } from '../modal';

/** Одно окно стека: отдаёт компоненту его номер (для закрытия себя) и пробрасывает close/done. */
const props = defineProps<{ item: ModalItem }>();
provide(MODAL_ID, props.item.id);

const emit = defineEmits<{ close: []; done: [value: unknown] }>();
</script>

<template>
  <component :is="item.component" v-bind="item.props" @close="emit('close')" @done="(v: unknown) => emit('done', v)" />
</template>
