// Модальные окна (стек), подтверждение и уведомления — без alert/confirm/prompt.
// Окно — любой компонент с корнем ModalShell, принимающий props и эмитящий close.

import { ref, shallowReactive, markRaw, type Component, type InjectionKey } from 'vue';
import ConfirmModal from './components/ConfirmModal.vue';

/** Номер своего окна — чтобы закрыть именно его, а не верхнее в стеке. */
export const MODAL_ID: InjectionKey<number> = Symbol('modalId');

export interface ModalItem {
  id: number;
  component: Component;
  props: Record<string, unknown>;
}

let nextId = 1;
export const modals = shallowReactive<ModalItem[]>([]);

export function openModal(component: Component, props: Record<string, unknown> = {}): number {
  const id = nextId++;
  modals.push({ id, component: markRaw(component), props });
  return id;
}

/** Без аргумента закрывает верхнее окно. */
export function closeModal(id?: number): void {
  const index = id === undefined ? modals.length - 1 : modals.findIndex((m) => m.id === id);
  if (index >= 0) modals.splice(index, 1);
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

/** Вопрос владельцу; разрушающие действия — только после «да». */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    openModal(ConfirmModal, { ...options, onDone: resolve });
  });
}

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'ok';
}

export const toasts = ref<Toast[]>([]);
const TOAST_MS = 4500;

export function toast(text: string, kind: Toast['kind'] = 'error'): void {
  const id = nextId++;
  toasts.value.push({ id, text, kind });
  setTimeout(() => dismissToast(id), TOAST_MS);
}

export function dismissToast(id: number): void {
  const index = toasts.value.findIndex((t) => t.id === id);
  if (index >= 0) toasts.value.splice(index, 1);
}

/** Текст в буфер обмена; вне защищённого контекста — честная ошибка. */
export async function copyText(text: string): Promise<void> {
  if (!navigator.clipboard) throw new Error('Clipboard is unavailable in this browser');
  await navigator.clipboard.writeText(text);
}
