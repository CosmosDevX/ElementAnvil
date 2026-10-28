const $ = (id) => document.getElementById(id);
export function mountHttpView() {
  const workspace = $("http-workspace");
  workspace.innerHTML = `
      <div class="ut-http-heading"><strong>HTTP-клиент</strong><span id="http-location"></span><span id="http-loading" role="status"></span><button id="http-run-project" class="ut-secondary">Запустить проект</button><button id="http-back" class="ut-secondary">К коду</button></div>
      <div class="ut-http-collections" aria-label="Коллекция запросов">
        <div class="ut-http-collection-tools"><button id="http-new-folder" class="ut-secondary">＋ Папка</button><button id="http-new-request" class="ut-primary">＋ Запрос</button></div>
        <button id="http-root" class="ut-http-root">Все запросы</button><div id="http-tree" role="tree" aria-label="Папки и HTTP-запросы"></div>
        <div class="ut-http-collection-footer"><button id="http-rename" class="ut-text-button" disabled>Переименовать</button><button id="http-delete" class="ut-text-button" disabled>Удалить</button><button id="http-undo" class="ut-text-button ut-hidden">Отменить удаление</button><span id="http-save-state" role="status"></span></div>
      </div>
      <div class="ut-http-main">
        <div class="ut-http-base"><label for="http-base-url">Базовый URL</label><input id="http-base-url" placeholder="Базовый URL" spellcheck="false" /></div>
        <div class="ut-http-base"><label for="http-note">Заметка</label><textarea id="http-note" aria-label="Заметка к коллекции" placeholder="Заметка к окружению или API" maxlength="16000" rows="2"></textarea></div>
        <div id="http-empty" class="ut-http-empty">Создай папку для эндпоинта и добавь запрос.</div>
        <section id="http-request-editor" class="ut-hidden" aria-label="Редактор HTTP-запроса">
          <div class="ut-http-request-name"><input id="http-request-name" aria-label="Название запроса" maxlength="120" /><select id="http-request-folder" aria-label="Папка запроса"></select></div>
          <div class="ut-http-url-row"><select id="http-method" aria-label="Тип запроса">${["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].map((method) => `<option>${method}</option>`).join("")}</select><input id="http-path" aria-label="Путь или URL" placeholder="Путь или полный URL" spellcheck="false" /><button id="http-send" class="ut-primary" title="Отправить · Ctrl+Enter">Отправить</button><button id="http-cancel" class="ut-secondary ut-hidden">Отменить</button></div>
          <div class="ut-http-tabs" role="tablist" aria-label="Параметры запроса"><button role="tab" data-http-tab="pathParams">Параметры пути</button><button role="tab" data-http-tab="query">Параметры запроса</button><button role="tab" data-http-tab="headers">Заголовки</button><button role="tab" data-http-tab="body">Тело</button></div>
          <div id="http-parameter-area"><div id="http-query-options" class="ut-hidden ut-http-options"><label for="http-query-separator">Разделитель параметров</label><select id="http-query-separator"><option value="&">&amp; — стандартный</option><option value=";">; — совместимость</option></select></div><div id="http-parameters"></div><button id="http-add-parameter" class="ut-text-button">＋ Параметр</button></div>
          <div id="http-body-area" class="ut-hidden"><select id="http-body-type" aria-label="Тип тела запроса"><option value="none">Без тела</option><option value="json">JSON</option><option value="text">Текст</option></select><textarea id="http-request-body" aria-label="Тело запроса" spellcheck="false" placeholder='{"name": "Иван"}'></textarea></div>
          <div class="ut-http-options ut-http-timeout"><label for="http-timeout">Тайм-аут, сек</label><input id="http-timeout" type="number" min="1" max="120" value="30" /></div>
        </section>
        <section class="ut-http-response" aria-label="HTTP-ответ"><div class="ut-http-response-heading"><strong>Ответ</strong><span id="http-response-status"></span><span id="http-response-meta"></span></div><div class="ut-http-tabs"><button id="http-response-body-tab">Тело ответа</button><button id="http-response-headers-tab">Заголовки ответа</button><label class="ut-http-pretty"><input id="http-pretty" type="checkbox" checked /> Форматировать JSON</label></div><pre id="http-response-body" tabindex="0">Отправь запрос, чтобы увидеть ответ.</pre><div id="http-response-headers" class="ut-hidden"></div></section>
      </div>
      <dialog id="http-name-dialog" class="ut-dialog ut-http-dialog"><form id="http-name-form"><div class="ut-dialog-heading"><h2 id="http-name-title">Новая папка</h2><button id="http-name-close" type="button" class="ut-icon-button" aria-label="Закрыть создание запроса">×</button></div><label class="ut-setting-label" for="http-new-name">Название</label><input id="http-new-name" maxlength="120" required autocomplete="off" /><div class="ut-dialog-actions"><button class="ut-primary" type="submit">Сохранить</button></div></form></dialog>`;
  const collections = workspace.querySelector(".ut-http-collections");
  const heading = document.createElement("div");
  heading.className = "ut-side-heading";
  const title = document.createElement("strong");
  title.textContent = "HTTP-клиент";
  heading.append(title);
  $("http-view").append(heading, collections);
  document.body.append($("http-name-dialog"));
}
