// Локализация интерфейса (карточка 048): только представление, никогда данные.
// Ключ — сам английский текст: `t('New task')` отдаёт его на текущем языке. Имена колонок, карточек,
// полей файлов не переводятся: подпись в интерфейсе обязана равняться имени в файловой системе.
import { ref } from 'vue';

export type Locale = 'en' | 'ru';

const STORAGE = 'viboard.locale';

/** Английский текст → русский. Отсутствующий ключ остаётся английским. */
const ru: Record<string, string> = {
  Language: 'Язык',
  'How viboard works': 'Как устроен viboard',
  'viboard is a task board that is a regular folder on your disk. You work in this window; an AI agent works with the same tasks as files.':
    'viboard — это доска задач, которая лежит обычной папкой на диске. Вы работаете в этом окне, ИИ-агент — с теми же задачами как с файлами.',
  'Create a task': 'Создайте задачу',
  'Press «+ Task», fill in the title and the description.': 'Нажмите «+ Задача», заполните название и описание.',
  'Open «Agent», copy the first line and paste it into the chat of your agent.':
    'Откройте «Агент», скопируйте первую строку и вставьте её в чат своего агента.',
  'The agent picks the task up': 'Агент возьмёт задачу',
  'It moves the card itself: todo → doing → review → done. Its questions appear in «Chat».':
    'Он сам двигает карточку: todo → doing → review → done. Его вопросы появляются в «Чате».',
  'Hide the details': 'Свернуть',
  'Columns and files': 'Колонки и файлы',
  Columns: 'Колонки',
  'not ready to be taken': 'постановка не готова',
  'ready to be taken': 'можно брать',
  'someone is working on it': 'кто-то работает',
  'waits for your answer in «Chat»': 'ждёт вашего ответа в «Чате»',
  'done, waits for verification': 'сделано, ждёт проверки',
  closed: 'закрыта',
  'Where the files are': 'Где файлы',
  'Everything you see here is in this folder. Open it in any file manager — the cards are ordinary files:':
    'Всё, что вы видите здесь, лежит в этой папке. Откройте её в любом файловом менеджере — карточки это обычные файлы:',
  'Got it': 'Понятно',
  Help: 'Справка',
  '+ Task': '+ Задача',
  '+ column': '+ колонка',
  Agent: 'Агент',
  'All projects': 'Все проекты',
  'Attach file': 'Прикрепить файл',
  'Back to list': 'К списку',
  Board: 'Доска',
  'Board moved to {path}': 'Доска перенесена в {path}',
  'Briefing copied': 'Текст задания скопирован',
  'Briefing for a new session': 'Задание для новой сессии',
  'Briefing text': 'Текст задания',
  Cancel: 'Отмена',
  'Git sync': 'Синхронизация с git',
  'The board lies inside another repository. Sync works only when the board folder is a repository of its own.':
    'Доска лежит внутри другого репозитория. Синхронизация работает, только когда папка доски — отдельный репозиторий.',
  'Git is not installed. Install Git to sync this board between devices.':
    'Git не установлен. Установите Git, чтобы синхронизировать доску между устройствами.',
  'The board is a git repository: commit and push send your changes, pull brings the changes from another device.':
    'Доска — git-репозиторий: commit и push отправляют ваши изменения, pull приносит изменения с другого устройства.',
  Remote: 'Удалённый',
  'not connected': 'не подключён',
  Status: 'Состояние',
  'Sync is off': 'Выключена',
  'Up to date': 'Всё отправлено',
  'Not sent yet': 'Есть неотправленное',
  Conflict: 'Конфликт',
  'Sync failed': 'Ошибка синхронизации',
  Connect: 'Подключить',
  'Remote repository connected': 'Удалённый репозиторий подключён',
  'Pull automatically': 'Тянуть автоматически',
  'Commit and push automatically': 'Коммитить и отправлять автоматически',
  'Sync now': 'Синхронизировать',
  Synced: 'Синхронизировано',
  'Copy prompt for the agent': 'Скопировать промпт для агента',
  'Git sync needs your attention': 'Синхронизация с git требует внимания',
  'Sync conflict': 'Конфликт синхронизации',
  'Use this board as the default': 'Сделать эту доску доской по умолчанию',
  'The same files changed on two devices. Nothing is lost: this device keeps its changes; they are not sent until the conflict is resolved.':
    'Одни и те же файлы изменены на двух устройствах. Ничего не потеряно: это устройство сохраняет свои изменения; они не отправляются, пока конфликт не разрешён.',
  'The conflict is still there': 'Конфликт всё ещё есть',
  '{count} files are left in the old folder — close the program that holds them and delete {path}':
    'В старой папке осталось файлов: {count} — закройте программу, которая их держит, и удалите {path}',
  'The default board is unchanged: {path}': 'Доска по умолчанию не изменилась: {path}',
  Chat: 'Чат',
  'Clear filters': 'Сбросить фильтры',
  Close: 'Закрыть',
  'Column «{name}» is empty and will be deleted.': 'Колонка «{name}» пуста и будет удалена.',
  'Connect an agent': 'Подключить агента',
  Copied: 'Скопировано',
  Copy: 'Копировать',
  'Copy for agent': 'Скопировать для агента',
  Create: 'Создать',
  Default: 'По умолчанию',
  'Delete card': 'Удалить карточку',
  'Delete column': 'Удалить колонку',
  Delete: 'Удалить',
  Description: 'Описание',
  Edit: 'Редактировать',
  'Enter the new folder': 'Укажите новую папку',
  Executor: 'Исполнитель',
  'File is larger than 20 MB': 'Файл больше 20 МБ',
  Folder: 'Папка',
  'In progress': 'В работе',
  'Left behind, open in another program: {file}': 'Остался на месте, файл открыт в другой программе: {file}',
  'Loading…': 'Загрузка…',
  Manager: 'Менеджер',
  Message: 'Сообщение',
  'Move anyway — working agents keep reading the old folder':
    'Перенести всё равно — работающие агенты продолжат читать старую папку',
  'Move the board': 'Перенести доску',
  'Move to another folder': 'Перенести в другую папку',
  Move: 'Перенести',
  Name: 'Название',
  'New column': 'Новая колонка',
  'New project': 'Новый проект',
  'New task': 'Новая задача',
  'No connection to the board server': 'Нет соединения с сервером доски',
  'No messages': 'Сообщений нет',
  Password: 'Пароль',
  Priority: 'Приоритет',
  Project: 'Проект',
  'Project folder': 'Папка проекта',
  'Project name': 'Название проекта',
  Question: 'Вопрос',
  Reviewer: 'Проверяющий',
  Save: 'Сохранить',
  Search: 'Поиск',
  'Sign in': 'Войти',
  Send: 'Отправить',
  'The board moves to {path}. Agents working on it now read files from the old folder — stop them first.':
    'Доска переносится в {path}. Агенты, которые работают с ней сейчас, читают файлы из старой папки — сначала остановите их.',
  'This board is now the default': 'Эта доска теперь открывается по умолчанию',
  Title: 'Название',
  Untitled: 'Без названия',
  'Waiting for you': 'Ждёт ответа',
  agent: 'агент',
  empty: 'пусто',
  'no matches': 'нет совпадений',
  'takes the top free card in todo/': 'возьмёт верхнюю свободную карточку из todo/',
  'verifies a card in review/ that has no verdict': 'проверит карточку в review/ без вердикта',
  '{shown} of {total} cards': 'карточек: {shown} из {total}',
  'a pass over the board: checklist, unblocking, commit': 'проход по доске: чек-лист, развязка, коммит',
  '«viboard» without arguments opens the default folder, not this one.':
    'viboard без аргументов открывает папку по умолчанию, а не эту.',
  '«{title}» will be deleted with its log and attachments. It can only be restored from git history.':
    '«{title}» удалится вместе с логом и вложениями. Отменить можно только из истории git.',
};

export const locales: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: 'ru', label: 'Ru' },
  { id: 'en', label: 'En' },
];

function initial(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE);
    if (saved === 'ru' || saved === 'en') return saved;
  } catch {
    /* хранилище недоступно — язык браузера */
  }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export const locale = ref<Locale>(initial());
// <html lang> сразу равен языку интерфейса: экранный диктор и переводчик страницы не считают её русской
document.documentElement.lang = locale.value;

export function setLocale(next: Locale): void {
  locale.value = next;
  try {
    localStorage.setItem(STORAGE, next);
  } catch {
    /* без запоминания язык действует до перезагрузки */
  }
  document.documentElement.lang = next;
}

/** Текст на текущем языке; `{name}` в тексте заменяются значениями из params. */
export function t(text: string, params?: Record<string, string | number>): string {
  let out = locale.value === 'ru' ? (ru[text] ?? text) : text;
  if (params) {
    for (const [key, value] of Object.entries(params)) out = out.split(`{${key}}`).join(String(value));
  }
  return out;
}
