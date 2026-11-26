<script setup lang="ts">
// QR-код как SVG (UD-55): ссылка с одноразовым ключом для телефона. Генератор — qrcode-generator (MIT),
// попадает только в сборку интерфейса; зависимости в рантайме у пакета по-прежнему нет.
import { computed } from 'vue';
import qrcode from 'qrcode-generator';
import { t } from '../i18n';

const props = defineProps<{ text: string }>();

/** Модули QR: true — тёмный. */
const modules = computed<boolean[][]>(() => {
  const qr = qrcode(0, 'M'); // 0 — размер по длине текста
  qr.addData(props.text, 'Byte');
  qr.make();
  const count = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let row = 0; row < count; row++) {
    const line: boolean[] = [];
    for (let col = 0; col < count; col++) line.push(qr.isDark(row, col));
    rows.push(line);
  }
  return rows;
});
const size = computed(() => modules.value.length);
</script>

<template>
  <svg
    class="qr"
    :viewBox="`-2 -2 ${size + 4} ${size + 4}`"
    role="img"
    :aria-label="t('QR code with the link')"
    shape-rendering="crispEdges"
  >
    <rect :x="-2" :y="-2" :width="size + 4" :height="size + 4" fill="#fff" />
    <template v-for="(row, r) in modules" :key="r">
      <template v-for="(dark, c) in row" :key="c">
        <rect v-if="dark" :x="c" :y="r" width="1" height="1" fill="#000" />
      </template>
    </template>
  </svg>
</template>
