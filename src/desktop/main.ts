// Карточка 046: exe в electron-оболочке. Оболочка тонкая — весь код доски тот же, что у CLI:
// главный процесс запускает сервер на 127.0.0.1 и открывает его в окне. Отдельной логики доски здесь нет.

import { BrowserWindow, Menu, app, dialog } from 'electron';

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
    // карточка 150: portable-запуску нужен явный идентификатор — иначе панель задач показывает значок
    // не нашего окна, а загрузчика
    app.setAppUserModelId(process.execPath);
    Menu.setApplicationMenu(null); // без строки меню File / Edit / View / Window
    try {
      await openDesktop(await prepareDesktopBoard());
    } catch (error) {
      fatal(error);
      void app.quit();
    }
  });
}
