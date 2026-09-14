import type { CommandRegistry } from '../core/commands/registry';

/** 快捷键一览。用原生 <dialog>，不引入任何 UI 依赖。 */
export class ShortcutsDialog {
  readonly #dialog: HTMLDialogElement;

  constructor(registry: CommandRegistry) {
    this.#dialog = document.createElement('dialog');
    this.#dialog.className = 'dialog';

    const title = document.createElement('h2');
    title.textContent = '快捷键';

    const list = document.createElement('div');
    list.className = 'dialog__list';

    for (const definition of registry.all()) {
      if (definition.keys === undefined || definition.keys.length === 0) continue;
      const row = document.createElement('div');
      row.className = 'dialog__row';

      const name = document.createElement('span');
      name.textContent = definition.title;
      const keys = document.createElement('kbd');
      keys.textContent = definition.keys[0]?.replace(/Mod/g, 'Ctrl/Cmd').replace(/-/g, '+') ?? '';

      row.append(name, keys);
      list.append(row);
    }

    const extra = document.createElement('div');
    extra.className = 'dialog__list';
    for (const [label, keys] of Object.entries({
      查找: 'Ctrl/Cmd + F',
      替换: 'Ctrl/Cmd + H',
      保存: 'Ctrl/Cmd + S',
      另存为: 'Ctrl/Cmd + Shift + S',
      放大: 'Ctrl/Cmd + +',
      缩小: 'Ctrl/Cmd + -',
      重置缩放: 'Ctrl/Cmd + 0',
    })) {
      const row = document.createElement('div');
      row.className = 'dialog__row';
      const name = document.createElement('span');
      name.textContent = label;
      const kbd = document.createElement('kbd');
      kbd.textContent = keys;
      row.append(name, kbd);
      extra.append(row);
    }

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'dialog__close';
    close.textContent = '关闭';
    close.addEventListener('click', () => this.close());

    this.#dialog.append(title, list, extra, close);
    document.body.append(this.#dialog);
  }

  show(): void {
    this.#dialog.showModal();
  }

  close(): void {
    this.#dialog.close();
  }
}
