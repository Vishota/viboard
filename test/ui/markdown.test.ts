import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../../ui/src/markdown';

describe('renderMarkdown: разметка', () => {
  it('акценты и код', () => {
    expect(renderMarkdown('**жирный**, *курсив* и `код`')).toBe(
      '<p><strong>жирный</strong>, <em>курсив</em> и <code>код</code></p>',
    );
    expect(renderMarkdown('snake_case не курсив')).toBe('<p>snake_case не курсив</p>');
  });

  it('заголовки, списки, цитата, разделитель', () => {
    const src = ['## Итог', '', '- один', '- два', '', '1. первый', '2) второй', '', '> цитата', '---'].join('\n');
    expect(renderMarkdown(src)).toBe(
      [
        '<h3>Итог</h3>',
        '<ul><li>один</li><li>два</li></ul>',
        '<ol><li>первый</li><li>второй</li></ol>',
        '<blockquote><p>цитата</p></blockquote>',
        '<hr>',
      ].join('\n'),
    );
  });

  it('блок кода сохраняет содержимое без разметки', () => {
    expect(renderMarkdown('```js\nif (a < b) { x(); }\n```')).toBe('<pre><code>if (a &lt; b) { x(); }</code></pre>');
  });

  it('таблица', () => {
    const src = '| что | где |\n|---|---|\n| баг | server.ts:12 |';
    expect(renderMarkdown(src)).toBe(
      '<table><thead><tr><th>что</th><th>где</th></tr></thead><tbody><tr><td>баг</td><td>server.ts:12</td></tr></tbody></table>',
    );
  });

  it('абзацы разделяются пустой строкой, перенос строки — <br>', () => {
    expect(renderMarkdown('первая\nвторая\n\nтретья')).toBe('<p>первая<br>вторая</p>\n<p>третья</p>');
  });
});

describe('renderMarkdown: ссылки', () => {
  it('http(s) и mailto становятся ссылками, амперсанд экранируется один раз', () => {
    expect(renderMarkdown('[текст](https://a.b/c?d=1&e=2)')).toBe(
      '<p><a href="https://a.b/c?d=1&amp;e=2" target="_blank" rel="noopener noreferrer">текст</a></p>',
    );
    expect(renderMarkdown('https://example.com/x?y=1&z=2')).toBe(
      '<p><a href="https://example.com/x?y=1&amp;z=2" target="_blank" rel="noopener noreferrer">https://example.com/x?y=1&amp;z=2</a></p>',
    );
    expect(renderMarkdown('[почта](mailto:a@b.c)')).toContain('href="mailto:a@b.c"');
  });

  it('javascript: и данные-схемы ссылками не становятся', () => {
    const out = renderMarkdown('[x](javascript:alert(1)) и [y](data:text/html,zz)');
    expect(out).not.toContain('<a ');
    expect(out).toContain('[x](javascript:alert(1))');
  });
});

describe('renderMarkdown: внедрение разметки невозможно', () => {
  it('html экранируется', () => {
    const out = renderMarkdown('<img src=x onerror=alert(1)><script>alert(2)</script>');
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<script');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('атрибут ссылки нельзя подменить через текст или адрес', () => {
    // ссылкой становится только чистый префикс адреса; кавычки вокруг onmouseover — экранированный текст
    const out = renderMarkdown('[" onmouseover="alert(1)](https://a.b/"onmouseover="alert(1))');
    expect(out).not.toContain('onmouseover="alert');
    expect(out).toContain('href="https://a.b/"');
    expect(out).toContain('&quot; onmouseover=&quot;alert(1)');
    const bare = renderMarkdown('https://a.b/x"onmouseover="alert(1)');
    expect(bare).toContain('href="https://a.b/x"');
    expect(bare).toContain('&quot;onmouseover=&quot;');
  });

  it('адрес обрывается на кавычке, угловой скобке и пробеле; остальное — текст', () => {
    const quoted = renderMarkdown('[x](https://a.b/"><b>)');
    expect(quoted).toContain('href="https://a.b/"');
    expect(quoted).not.toContain('<b>');
    expect(renderMarkdown('[x](https://a.b/a b)')).toContain('href="https://a.b/a"');
    const tagged = renderMarkdown('https://a.b/<b>');
    expect(tagged).toContain('href="https://a.b/"');
    expect(tagged).not.toContain('<b>');
  });
});
