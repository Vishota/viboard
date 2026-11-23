import js from '@eslint/js';
import { withVueTs, vueTsConfigs } from '@vue/eslint-config-typescript';
import prettier from 'eslint-config-prettier';
import pluginVue from 'eslint-plugin-vue';

// Стиль отдан Prettier; здесь — ошибки и семантика (типизированные правила typescript-eslint включены).
export default withVueTs(
  {
    ignores: ['dist/**', 'node_modules/**', 'board/**', 'archive/**', 'current/**', 'tmp/**'],
  },
  js.configs.recommended,
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommendedTypeChecked,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'vue/multi-word-component-names': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // CLI печатает в терминал по назначению.
    files: ['src/cli/**', 'src/bin/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
