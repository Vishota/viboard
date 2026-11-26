/** Черновики сообщений: переживают переключение тредов, закрытие чата и перезагрузку страницы.
 *  Карточка 154: поле при открытии треда пустое, а сохранённый текст возвращается ссылкой «восстановить черновик». */
const PREFIX = 'viboard.draft.';
const drafts = new Map<string, string>();

function read(thread: string): string {
  try {
    return localStorage.getItem(PREFIX + thread) ?? '';
  } catch {
    return '';
  }
}

export const draftOf = (thread: string): string => drafts.get(thread) ?? read(thread);

export const saveDraft = (thread: string, text: string): void => {
  drafts.set(thread, text);
  try {
    if (text.trim() === '') localStorage.removeItem(PREFIX + thread);
    else localStorage.setItem(PREFIX + thread, text);
  } catch {
    /* хранилище недоступно или полно — черновик живёт до перезагрузки страницы */
  }
};
