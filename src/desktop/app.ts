// Карточка 046: окно exe в electron-оболочке. Оболочка тонкая — весь код доски тот же, что у CLI:
// главный процесс запускает сервер на 127.0.0.1 и открывает его в окне. Отдельной логики доски здесь нет.

import { BrowserWindow, shell } from 'electron';
import { APP } from '../core/names.js';
import { UI_DIR } from '../core/paths.js';
import { clearRun, probe, readRun, writeRun } from '../core/run.js';
import { startServer } from '../server/server.js';

/** Открыть доску в окне; окно закрывается — приложение выходит. */
export async function openDesktop(board: string): Promise<void> {
  // Ту же доску уже показывает запущенный `viboard ui` — открываем его, второго сервера не нужно.
  const running = readRun(board);
  const server = running && (await probe(running)) ? null : await startServer({ board, uiDir: UI_DIR });
  if (server)
    writeRun(board, { app: APP, port: server.port, pid: process.pid, board, startedAt: new Date().toISOString() });

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'viboard',
    backgroundColor: '#111111',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  // Ссылка на GitHub и прочие внешние адреса — в браузер системы, не в новое окно приложения.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(running ? `http://127.0.0.1:${running.port}` : (server?.url ?? ''))) {
      event.preventDefault();
      if (url.startsWith('https://')) void shell.openExternal(url);
    }
  });
  window.on('closed', () => {
    if (server) {
      clearRun(board);
      void server.close();
    }
  });
  // Что видит страница: ошибка загрузки, сообщение консоли, упавший рендер — в stderr запустившего.
  window.webContents.on('did-fail-load', (_event, code, description, url, mainFrame) =>
    console.error(`[viboard] failed to load ${mainFrame ? 'main frame' : 'frame'} ${url}: ${code} ${description}`),
  );
  window.webContents.on('console-message', (event) => {
    if (event.level !== 'info') console.error(`[viboard] page ${event.level}: ${event.message}`);
  });
  window.webContents.on('render-process-gone', (_event, details) =>
    console.error(`[viboard] renderer gone: ${details.reason} (${details.exitCode})`),
  );
  await window.loadURL(server?.url ?? `http://127.0.0.1:${running?.port}`);
}
