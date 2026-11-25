import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { BoardState, CardSummary, Message, Thread } from '../../src/core/types.js';
import App from '../../ui/src/App.vue';
import BoardView from '../../ui/src/components/BoardView.vue';
import FilterBar from '../../ui/src/components/FilterBar.vue';
import SyncPanel from '../../ui/src/components/SyncPanel.vue';
import ThreadView from '../../ui/src/components/ThreadView.vue';
import { toasts } from '../../ui/src/modal';
import { cardMatches, filterActive, filters, resetFilters, chatOpen, state, stopPolling } from '../../ui/src/store';
import { setLocale, t } from '../../ui/src/i18n';

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
});

describe('локализация интерфейса (карточка 048)', () => {
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
