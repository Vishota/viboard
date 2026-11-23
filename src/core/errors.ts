/** Ожидаемая, читаемая человеком ошибка: CLI печатает её как есть, сервер отдаёт 400. */
export class Fail extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Fail';
  }
}
