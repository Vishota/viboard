<script setup lang="ts">
// Ярлык карточки — один вид во всех местах (слово владельца: «из одного и того же места, одинаковые»).
// Новую отрисовку владелец нарисует позже — здесь одно место, где её менять.
import { computed } from 'vue';

const props = defineProps<{
  name: string;
  /** В форме: ярлык выбран. */
  on?: boolean;
  /** В форме ярлык переключается кликом. */
  toggle?: boolean;
}>();

const tag = computed(() => (props.toggle ? 'button' : 'span'));
const classes = computed(() => [
  'chip',
  'chip-label',
  { 'chip-on': props.on === true, 'chip-toggle': props.toggle === true },
]);
</script>

<template>
  <component
    :is="tag"
    :type="toggle ? 'button' : undefined"
    :class="classes"
    :aria-pressed="toggle ? on === true : undefined"
    @click="toggle && $emit('toggle', name)"
  >
    {{ name }}
  </component>
</template>
