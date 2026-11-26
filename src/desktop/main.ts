// Карточка 046: exe в electron-оболочке. Оболочка тонкая — весь код доски тот же, что у CLI:
// главный процесс запускает сервер на 127.0.0.1 и открывает его в окне. Отдельной логики доски здесь нет.

import { BrowserWindow, Menu, app, dialog } from 'electron';

import { ownPackage } from '../core/paths.js';
import { openDesktop } from './app.js';
import { prepareDesktopBoard } from './board.js';

function fatal(error: unknown): void {
  dialog.showErrorBox('viboard', `${error instanceof Error ? error.message : String(error)}`);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isMinimized()) window.restore();
      window.focus();
    }
  });
  app.on('window-all-closed', () => void app.quit());
  void app.whenReady().then(async () => {
    // Идентификатор окна для панели задач — тот же, что у ярлыков установщика (build.appId): тогда закреплённый
    // значок и работающее окно — одно приложение. Без appId (запуск из репозитория) — путь к exe.
    const appId = ownPackage()?.json.appId;
    app.setAppUserModelId(typeof appId === 'string' ? appId : process.execPath);
    Menu.setApplicationMenu(null); // без строки меню File / Edit / View / Window
    try {
      await openDesktop(await prepareDesktopBoard());
    } catch (error) {
      fatal(error);
      void app.quit();
    }
  });
}
