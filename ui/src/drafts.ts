/** Черновики сообщений переживают переключение тредов и закрытие чата. */
const drafts = new Map<string, string>();

export const draftOf = (thread: string): string => drafts.get(thread) ?? '';
export const saveDraft = (thread: string, text: string): void => {
  drafts.set(thread, text);
};
