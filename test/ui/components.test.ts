import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { BoardState, CardSummary, Message, Thread } from '../../src/core/types.js';
import App from '../../ui/src/App.vue';
import BoardColumn from '../../ui/src/components/BoardColumn.vue';
import CardModal from '../../ui/src/components/CardModal.vue';
import ChatPanel from '../../ui/src/components/ChatPanel.vue';
import BoardView from '../../ui/src/components/BoardView.vue';
import FilterBar from '../../ui/src/components/FilterBar.vue';
import SyncPanel from '../../ui/src/components/SyncPanel.vue';
import ThreadView from '../../ui/src/components/ThreadView.vue';
import { modals, toasts } from '../../ui/src/modal';
import {
  activeThread,
  bodyHits,
  cardMatches,
  filterActive,
  filters,
  resetFilters,
  chatOpen,
  state,
  stopPolling,
} from '../../ui/src/store';
import { locale, setLocale, t } from '../../ui/src/i18n';

const T = Date.parse('2026-11-23T10:00:00Z');

const agent = (body: string, time = T): Message => ({
  side: 'agent',
  session: 'aaaa1111',
  time,
  body,
  attachment: null,
});

const owner = (body: string, time = T + 1000): Message => ({
  side: 'user',
  session: 'owner',
  time,
  body,
  attachment: null,
});

const thread = (messages: Message[]): Thread => ({
  dir: '2026-11-23T100000Z-aaaa1111-001-x-q',
  card: '001-x',
  created: '2026-11-23T100000Z',
  answered: messages.some((m) => m.side === 'user'),
  lastFrom: messages.at(-1)?.side ?? 'agent',
  messages,
});

const card = (extra: Partial<CardSummary> = {}): CardSummary => ({
  name: 'app-001-x',
  id: '001-x',
  slug: 'x',
  column: 'todo',
  project: 'app',
  priority: 3,
  title: 'Задача',
  lockedBy: null,
  lockedAt: null,
  assets: 0,
  log: 0,
  answered: false,
  labels: [] as string[],
  ...extra,
});

const board = (cards: CardSummary[] = []): BoardState => ({
  root: 'C:/boards/demo',
  board: { path: 'C:/boards/demo', source: 'default', defaultPath: 'C:/boards/demo', isDefault: true, exists: true },
  version: '0.1.0',
  columns: ['backlog', 'todo', 'doing', 'blocked', 'review', 'done'],
  cards,
  projects: [{ id: 'app', name: 'Приложение', path: 'C:/proj/app' }],
  questions: [],
  prompts: { board: 'b', executor: 'e', reviewer: 'r', manager: 'm' },
  labels: ['agent'],
  protocol: { installed: '0.1.0', current: '0.1.0' },
  sync: {
    available: false,
    reason: 'no-git',
    remote: '',
    branch: '',
    autoPull: true,
    autoPush: true,
    state: 'off',
    pending: 0,
    message: '',
  },
});

/** Сервер на заглушке: состояние доски и «успех» на любую запись. */
function stubServer(
  snapshot: () => BoardState,
  status = 200,
): Mock<(url: string, init?: RequestInit) => Promise<object>> {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit): Promise<object> => {
    if (_url === '/api/state') {
      return Promise.resolve(
        status === 200
          ? { ok: true, status, text: () => Promise.resolve(JSON.stringify(snapshot())) }
          : { ok: false, status, text: () => Promise.resolve('') },
      );
    }
    return Promise.resolve({ ok: true, status, json: () => Promise.resolve({ file: 'x' }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  stopPolling();
  vi.unstubAllGlobals();
  state.value = null;
  chatOpen.value = false;
  activeThread.value = null;
  modals.splice(0);
  window.history.replaceState(null, '/', '/'); // адрес переживает тест и открывал бы окно в следующем
});

describe('тред чата', () => {
  it('черновик и фокус в поле переживают пришедшее сообщение агента', async () => {
    stubServer(() => board());
    const wrapper = mount(ThreadView, { props: { thread: thread([agent('Вопрос')]) }, attachTo: document.body });
    const field = wrapper.find('textarea');
    await field.setValue('почти дописал');

    await wrapper.setProps({ thread: thread([agent('Вопрос'), agent('Подождите ответа', T + 5000)]) });

    expect(wrapper.findAll('.msg')).toHaveLength(2);
    expect(field.element.value).toBe('почти дописал');
    expect(document.activeElement).toBe(field.element);
    wrapper.unmount();
  });

  it('варианты первого сообщения — кнопки; из пузыря раздел убран; после ответа кнопок нет', () => {
    const first = 'Какая база?\n\n## Options\n\n- 16px — рекомендую\n- 18px';
    const open = mount(ThreadView, { props: { thread: thread([agent(first)]) }, attachTo: document.body });
    expect(open.findAll('.variants button').map((b) => b.text())).toEqual(['16px — рекомендую', '18px']);
    expect(open.find('.msg.agent').text()).not.toContain('## Options');
    expect(open.find('.msg.agent').text()).toContain('Какая база?');
    open.unmount();

    const answered = mount(ThreadView, {
      props: { thread: thread([agent(first), owner('16px')]) },
      attachTo: document.body,
    });

    expect(answered.findAll('.variants')).toHaveLength(0);
    answered.unmount();
  });

  it('разметка варианта не попадает на кнопку: «**A.** путь» читается как «A. путь» (найдено вживую, карточка 057)', () => {
    const first = 'A или B?\n\n## Options\n\n- **A.** Первый путь\n- **B.** Второй путь';
    const open = mount(ThreadView, { props: { thread: thread([agent(first)]) }, attachTo: document.body });
    expect(open.findAll('.variants button').map((b) => b.text())).toEqual(['A. Первый путь', 'B. Второй путь']);
    open.unmount();
  });

  it('Enter отправляет и очищает поле, Shift+Enter — перенос строки', async () => {
    const fetchMock = stubServer(() => board());
    const wrapper = mount(ThreadView, { props: { thread: thread([agent('Вопрос')]) }, attachTo: document.body });
    const field = wrapper.find('textarea');

    await field.setValue('первая');
    await field.trigger('keydown', { key: 'Enter', shiftKey: true });
    expect(fetchMock).not.toHaveBeenCalled();

    await field.setValue('первая\nвторая');
    await field.trigger('keydown', { key: 'Enter' });
    await flushPromises();

    const sent = fetchMock.mock.calls.find((c) => c[0] === '/api/chat');
    expect(fetchMock.mock.calls.filter((c) => c[0] === '/api/chat')).toHaveLength(1);
    expect(sent?.[0]).toBe('/api/chat');
    const body: unknown = sent?.[1]?.body;
    expect(typeof body).toBe('string');
    expect(typeof body === 'string' ? JSON.parse(body) : null).toEqual({
      q: '2026-11-23T100000Z-aaaa1111-001-x-q',
      text: 'первая\nвторая',
    });
    expect(field.element.value).toBe('');
    wrapper.unmount();
  });

  it('текст агента показывается разметкой, владельца — как написан; вложения — картинки и ссылки', () => {
    const file: Message = {
      side: 'user',
      session: 'owner',
      time: T + 2000,
      body: 'данные.json',
      attachment: '2026-11-23T100002Z-owner-att-данные.json',
    };
    const wrapper = mount(ThreadView, {
      props: { thread: thread([agent('**Готово**, но `x` сломан'), owner('<b>как есть</b>'), file]) },
    });
    expect(wrapper.find('.msg.agent strong').text()).toBe('Готово');
    expect(wrapper.find('.msg.agent code').text()).toBe('x');
    expect(wrapper.find('.msg.user').text()).toBe('<b>как есть</b>');
    const link = wrapper.find('.msg.user a');
    expect(link.attributes('href')).toBe(
      '/api/chat-asset?q=2026-11-23T100000Z-aaaa1111-001-x-q&f=2026-11-23T100002Z-owner-att-%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D0%B5.json',
    );
    expect(link.text()).toContain('данные.json');
    wrapper.unmount();

    const picture = mount(ThreadView, {
      props: {
        thread: thread([
          {
            side: 'agent',
            session: 'aaaa1111',
            time: T + 3000,
            body: 'скрин.png',
            attachment: '2026-11-23T100003Z-aaaa1111-att-скрин.png',
          },
        ]),
      },
    });
    expect(picture.find('.msg.agent img').attributes('alt')).toBe('скрин.png');
    picture.unmount();
  });
});

describe('доска', () => {
  it('колонки — имена файловой системы; занятая карточка не перетаскивается и показывает лок', () => {
    state.value = board([
      card(),
      card({ id: '002-y', name: 'app-002-y', title: 'Срочная', priority: 1, column: 'doing', lockedBy: 'aaaa1111' }),
    ]);
    const wrapper = mount(BoardView);
    const columns = wrapper.findAll('.column');
    expect(columns.map((c) => c.find('h2').text())).toEqual(['backlog', 'todo', 'doing', 'blocked', 'review', 'done']);
    expect(columns[1]?.text()).toContain('Задача');
    expect(columns[1]?.find('.card').attributes('draggable')).toBe('true');
    const busy = columns[2]?.find('.card');
    expect(busy?.attributes('draggable')).toBe('false');
    expect(busy?.text()).toContain('lock-aaaa1111');
    expect(busy?.text()).toContain('P1');
    expect(busy?.text()).toContain('Приложение');
  });
});

describe('приложение', () => {
  it('сервер требует пароль — показан вход; после входа — доска', async () => {
    stubServer(() => board([card()]), 401);
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.find('input[type="password"]').exists()).toBe(true);
    expect(wrapper.find('.board').exists()).toBe(false);

    stubServer(() => board([card()]));
    await wrapper.find('form').trigger('submit');
    await flushPromises();
    expect(wrapper.find('.board').exists()).toBe(true);
    expect(wrapper.find('input[type="password"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it('кнопка «Чат» открывает панель; счётчик считает треды, где последнее сообщение от агента', async () => {
    const withThreads = board();
    withThreads.questions = [thread([agent('Жду ответа')]), thread([agent('Спрошено'), owner('Ответ')])];
    withThreads.questions[1] = {
      ...withThreads.questions[1]!,
      dir: '2026-11-23T110000Z-aaaa1111-002-y-q',
      card: '002-y',
      created: '2026-11-23T110000Z',
    };
    stubServer(() => withThreads);
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    const chatButton = wrapper.findAll('header button').find((b) => b.text().startsWith('Chat'));
    expect(chatButton?.text()).toBe('Chat1');
    await chatButton?.trigger('click');
    expect(wrapper.find('.chat').classes()).toContain('open');
    expect(wrapper.findAll('.thread-row')).toHaveLength(2);
    expect(wrapper.findAll('.thread-row .unread')).toHaveLength(1);
    wrapper.unmount();
  });
});

describe('поиск и фильтры (карточка 044)', () => {
  afterEach(() => resetFilters());

  it('текст, проект, приоритет и состояние сужают список; сброс возвращает всё', () => {
    state.value = board([
      card(),
      card({
        id: '002-y',
        name: 'app-002-y',
        title: 'Urgent fix',
        priority: 1,
        column: 'doing',
        lockedBy: 'aaaa1111',
      }),
      card({ id: '003-z', name: 'other-003-z', project: 'other', title: 'Elsewhere', priority: 5 }),
    ]);
    expect(state.value.cards.filter(cardMatches)).toHaveLength(3);

    filters.query = 'urgent';
    expect(state.value.cards.filter(cardMatches).map((c) => c.id)).toEqual(['002-y']);

    resetFilters();
    filters.project = 'app';
    expect(state.value.cards.filter(cardMatches)).toHaveLength(2);

    resetFilters();
    filters.priorities = [1];
    expect(state.value.cards.filter(cardMatches).map((c) => c.id)).toEqual(['002-y']);

    resetFilters();
    filters.locked = true;
    expect(state.value.cards.filter(cardMatches).map((c) => c.id)).toEqual(['002-y']);
    filters.locked = false;

    state.value.questions = [thread([agent('Waiting')])];
    resetFilters();
    filters.waiting = true;
    expect(state.value.cards.filter(cardMatches).map((c) => c.id)).toEqual(['001-x']);

    resetFilters();
    expect(filterActive.value).toBe(false);
  });

  it('строка фильтров показывает счётчик и очищается', async () => {
    state.value = board([card()]);
    const wrapper = mount(FilterBar, { attachTo: document.body });
    await wrapper.find('input[name="search"]').setValue('nothing-here');
    expect(wrapper.find('.filter-count').text()).toBe('0 of 1 cards');
    await wrapper.find('button[title="Clear filters"]').trigger('click');
    expect(filters.query).toBe('');
    expect(wrapper.find('.filter-count').exists()).toBe(false);
    wrapper.unmount();
  });

  it('кнопка удаления — только у пустой колонки, а не у отфильтрованной до нуля (найдено проверяющим)', async () => {
    state.value = board([card()]);
    const wrapper = mount(BoardColumn, { props: { column: 'todo' }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.find('.column-count').text()).toBe('1');
    expect(wrapper.find('.column-remove').exists()).toBe(false);

    filters.project = 'other'; // карточка спрятана фильтром, в колонке она остаётся
    await flushPromises();
    expect(wrapper.find('.column-count').text()).toBe('0/1');
    expect(wrapper.find('.column-remove').exists()).toBe(false);
    expect(wrapper.find('.empty').text()).toBe('no matches');

    resetFilters();
    filters.project = 'app';
    await flushPromises();
    expect(wrapper.find('.column-count').text()).toBe('1');
    wrapper.unmount();

    const empty = mount(BoardColumn, { props: { column: 'done' }, attachTo: document.body });
    await flushPromises();
    expect(empty.find('.column-remove').exists()).toBe(true);
    empty.unmount();
    document.body.innerHTML = '';
  });

  it('без доски (пароль, нет соединения) полосы фильтров нет', async () => {
    stubServer(() => board(), 401);
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await flushPromises();
    expect(document.querySelectorAll('input[name="search"]')).toHaveLength(0);
    expect(wrapper.text()).not.toContain('All projects');
    wrapper.unmount();
  });

  it('поздний ответ поиска не затирает актуальный; при смене запроса прежние совпадения сбрасываются (найдено проверяющим)', async () => {
    state.value = board([card({ id: '001-the' }), card({ id: '002-zz', name: 'app-002-zz' })]);
    let finishFirst: (value: object) => void = () => undefined;
    const answers: Record<string, string[]> = { the: ['app-001-the'], zz: ['app-002-zz'] };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string): Promise<object> => {
        if (url === '/api/state')
          return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify(state.value)) });
        const q = decodeURIComponent(url.split('q=')[1] ?? '');
        if (q === 'the') return new Promise<object>((resolve) => (finishFirst = resolve));
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ names: answers[q] ?? [] }) });
      }),
    );

    filters.query = 'the';
    await new Promise((r) => setTimeout(r, 260));
    expect(bodyHits.value.size).toBe(0); // ответ ещё не пришёл — совпадений нет
    filters.query = 'zz';
    expect(bodyHits.value.size).toBe(0); // под новым запросом не висят прежние совпадения
    await new Promise((r) => setTimeout(r, 260));
    expect([...bodyHits.value]).toEqual(['app-002-zz']);
    finishFirst({ ok: true, status: 200, json: () => Promise.resolve({ names: ['app-001-the'] }) });
    await new Promise((r) => setTimeout(r, 20));
    expect([...bodyHits.value]).toEqual(['app-002-zz']);
  });
});

describe('локализация интерфейса (карточка 048)', () => {
  it('<html lang> равен языку интерфейса с первого кадра; подсказки путей не портят обратные слэши (найдено проверяющим)', async () => {
    expect(document.documentElement.lang).toBe(locale.value);
    setLocale('ru');
    expect(document.documentElement.lang).toBe('ru');
    setLocale('en');
    expect(document.documentElement.lang).toBe('en');
    state.value = { ...board(), board: { ...board().board, isDefault: false, defaultPath: 'C:/boards/other' } };
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await flushPromises();
    const boardButton = wrapper.findAll('button').find((b) => b.text() === 'Board');
    void boardButton?.trigger('click');
    await flushPromises();
    const input = document.body.querySelector<HTMLInputElement>('.modal input[name="board-path"]');
    expect(input?.placeholder).toBe('C:\\boards\\my-board');
    expect(document.body.textContent).toContain('Use this board as the default');
    wrapper.unmount();
    document.body.innerHTML = '';
  });

  afterEach(() => setLocale('en'));

  it('переключатель меняет только представление; имена колонок и файлов не переводятся', async () => {
    stubServer(() => board([card()]));
    state.value = board([card()]);
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.find('header .btn').text()).toBe('+ Task');
    expect(wrapper.findAll('.locale-item').map((b) => b.text())).toEqual(['Ru', 'En']);

    await wrapper.findAll('.locale-item')[0]?.trigger('click');
    expect(wrapper.find('header .btn').text()).toBe('+ Задача');
    expect(wrapper.find('.column h2').text()).toBe('backlog'); // имя каталога
    expect(wrapper.find('.filter-project option').text()).toBe('Все проекты');
    expect(state.value.cards[0]?.name).toBe('app-001-x'); // данные не тронуты
    expect(t('Board moved to {path}', { path: 'C:/b' })).toBe('Доска перенесена в C:/b');
    wrapper.unmount();
  });

  it('подписи фильтров переводятся (вживую: «In progress» оставался английским)', async () => {
    setLocale('ru');
    const wrapper = mount(FilterBar, { attachTo: document.body });
    await flushPromises();
    expect(wrapper.text()).toContain('В работе');
    expect(wrapper.text()).toContain('Ждёт ответа');
    expect(wrapper.text()).not.toMatch(/In progress|Waiting for you/);
    wrapper.unmount();
  });
  it('справка показывается при первом входе и больше не показывается', async () => {
    localStorage.removeItem('viboard.onboarded');
    stubServer(() => board([card()]));
    const first = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(first.find('[role="dialog"] h3').text()).toBe('How viboard works');
    expect(first.findAll('.help-steps li')).toHaveLength(3);
    first.unmount();
    window.history.replaceState(null, '/', '/'); // открытая справка осталась в адресе

    const second = mount(App, { attachTo: document.body });
    await flushPromises();
    expect(second.find('[role="dialog"]').exists()).toBe(false);
    second.unmount();
  });
});

describe('синхронизация с git (карточка 049)', () => {
  const conflicted = (): BoardState => ({
    ...board(),
    sync: {
      available: true,
      reason: null,
      remote: 'https://github.com/you/board.git',
      branch: 'main',
      autoPull: true,
      autoPush: true,
      state: 'conflict',
      pending: 1,
      message: 'same files changed on two devices',
    },
  });

  it('конфликт виден в шапке без открытия окна Board; окно предлагает промпт для агента — на языке интерфейса', async () => {
    stubServer(conflicted);
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await flushPromises();
    expect(wrapper.text()).toContain('Sync conflict');
    const headerButton = wrapper.findAll('button').find((b) => b.text() === 'Sync conflict');
    void headerButton?.trigger('click');
    await flushPromises();
    const panel = document.body.querySelector('.sync-conflict');
    expect(panel?.textContent).toContain('same files changed on two devices');
    expect(panel?.textContent).toContain('Copy prompt for the agent');
    expect(document.body.textContent).toContain('Conflict · 1');
    wrapper.unmount();
    document.body.innerHTML = '';
  });

  it('тост говорит правду: конфликт остался — не «синхронизировано» (найдено вживую)', async () => {
    state.value = conflicted();
    const syncMock = vi.fn((_url: string, _init?: RequestInit): Promise<object> =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(conflicted().sync) }),
    );
    vi.stubGlobal('fetch', syncMock);
    const wrapper = mount(SyncPanel, { attachTo: document.body });
    await flushPromises();
    const now = wrapper.findAll('button').find((b) => b.text() === 'Sync now');
    void now?.trigger('click');
    await flushPromises();
    expect(toasts.value.map((item) => [item.text, item.kind])).toContainEqual(['The conflict is still there', 'error']);
    expect(toasts.value.some((item) => item.text === 'Synced')).toBe(false);
    wrapper.unmount();
  });
});

describe('адрес страницы хранит открытое (карточка 072)', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('ссылка с карточкой открывает карточку; открытое окно попадает в адрес и уходит оттуда при закрытии', async () => {
    const base = stubServer(() => board([card()]));
    const one = card();
    const detail = {
      card: {
        ...one,
        board: 'C:/boards/demo',
        dir: 'C:/boards/demo/todo/app-001-x',
        meta: {},
        body: 'Постановка задачи',
        lockedAt: null,
      },
      entries: [],
      assetSizes: {},
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit): Promise<object> =>
        String(url).startsWith('/api/card')
          ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(detail) })
          : base(url, init),
      ),
    );
    window.history.replaceState(null, '', '/?card=app-001-x');
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await flushPromises();
    await flushPromises();
    expect(document.body.textContent).toContain('Задача');
    expect(window.location.search).toBe('?card=app-001-x');

    void document.querySelector<HTMLButtonElement>('.modal button')?.click();
    await flushPromises();
    expect(window.location.search).toBe('');
    wrapper.unmount();
    document.body.innerHTML = '';
  });

  it('ссылка на тред открывает чат на этом треде; адрес меняется вместе с чатом', async () => {
    const dir = '2026-11-24T165125Z-41ae8240-q';
    const one = thread([agent('Thread question')]);
    const withThreads = { ...board(), questions: [{ ...one, dir, card: '' }] };
    stubServer(() => withThreads);
    window.history.replaceState(null, '', `/?thread=${dir}&chat=1`);
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await flushPromises();
    await flushPromises();
    expect(document.body.textContent).toContain('Thread question');
    expect(window.location.search).toBe(`?chat=1&thread=${dir}`);
    wrapper.unmount();
    document.body.innerHTML = '';
  });

  it('?help и ?board открываются по ссылке; несколько окон — в порядке стека', async () => {
    stubServer(() => board());
    window.history.replaceState(null, '', '/?board=1&help=1');
    const wrapper = mount(App, { attachTo: document.body });
    await flushPromises();
    await flushPromises();
    await flushPromises();
    expect(document.querySelectorAll('.modal')).toHaveLength(2);
    expect(window.location.search).toBe('?board=1&help=1');
    wrapper.unmount();
    document.body.innerHTML = '';
  });
});

describe('id карточки в интерфейсе (карточка 138)', () => {
  it('id виден на карточке в колонке и в открытой карточке', async () => {
    const one = card({ id: '057-problema' });
    state.value = board([one]);
    const boardView = mount(BoardColumn, { props: { column: 'todo' }, attachTo: document.body });
    await flushPromises();
    expect(boardView.find('.card-id').text()).toBe('057-problema');
    boardView.unmount();

    const detail = {
      card: {
        ...one,
        board: 'C:/boards/demo',
        dir: 'C:/boards/demo/todo/app-001-x',
        meta: {},
        body: '',
        lockedAt: null,
      },
      entries: [],
      assetSizes: {},
    };
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string): Promise<object> =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve(url.startsWith('/api/card') ? detail : state.value),
        }),
      ),
    );
    const wrapper = mount(CardModal, { props: { name: one.name }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.find('.card-id').text()).toBe('057-problema');
    wrapper.unmount();
    document.body.innerHTML = '';
  });
});

describe('чат и карточка связаны (карточка 057)', () => {
  afterEach(() => resetFilters());

  it('на карточке с ответом владельца — пометка; в списке чата у ветки виден проект карточки', async () => {
    const one = { ...card(), answered: true };
    const dir = '2026-11-25T223835Z-41ae8240-001-x-q';
    const withThreads = { ...board([one]), questions: [{ ...thread([agent('A or B?')]), dir, card: one.id }] };
    state.value = withThreads;
    const column = mount(BoardColumn, { props: { column: 'todo' }, attachTo: document.body });
    await flushPromises();
    expect(column.find('.chip-answered').text()).toBe('answered');
    column.unmount();

    chatOpen.value = true;
    const chat = mount(ChatPanel, { attachTo: document.body });
    await flushPromises();
    const row = chat.find('.thread-row');
    expect(row.find('.chip').text()).toBe('Приложение');
    expect(row.text()).toContain('Задача');
    chat.unmount();
    document.body.innerHTML = '';
  });
});

describe('ярлыки в интерфейсе (карточка 059)', () => {
  afterEach(() => resetFilters());

  it('ярлыки видны на карточке; фильтр по ярлыку сужает список', async () => {
    const one = card({ labels: ['agent', 'v0.2.0'] });
    state.value = {
      ...board([one, card({ id: '002-y', name: 'app-002-y', title: 'Другая', labels: [] })]),
      labels: ['agent', 'v0.2.0'],
    };
    const column = mount(BoardColumn, { props: { column: 'todo' }, attachTo: document.body });
    await flushPromises();
    expect(column.findAll('.chip-label').map((c) => c.text())).toEqual(['agent', 'v0.2.0']);
    column.unmount();

    filters.label = 'v0.2.0';
    expect(state.value.cards.filter(cardMatches).map((c) => c.id)).toEqual(['001-x']);
    const bar = mount(FilterBar, { attachTo: document.body });
    await flushPromises();
    expect(bar.findAll('select.filter-project option').map((o) => o.text())).toContain('v0.2.0');
    bar.unmount();
    document.body.innerHTML = '';
  });
});
