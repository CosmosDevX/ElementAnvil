import test from "node:test";
import assert from "node:assert/strict";
import { parseElementOutline } from "../public/element-outline.js";

test("Element outline groups fields and methods by structure and skips method locals", () => {
  const source = `#требуется Модуль.sbsl
// структура Ложная
@Глобально
структура Пользователь
    обз знч Ид: Число
    пер Имя: Строка = "метод Ложный();"
    конст Метки: Массив<Строка> = []
    @Глобально
    метод Изменить(Имя: Строка)
        пер Внутренняя: Число = 0
        если Истина
            попытка
                Консоль.Записать("структура Нет")
            поймать Исключение: ИсключениеНедопустимыйАргумент
                возврат
            ;
        иначе если Ложь
            возврат
        ;
    ;
    статический метод Создать(): Пользователь
        возврат новый Пользователь(1, "Иван")
    ;
;
метод Скрипт()
;
структура Ответ
    обз знч Статус: Число
;
`;
  const nodes = parseElementOutline(source);
  assert.deepEqual(
    nodes.map((node) => node.name),
    ["Пользователь", "Скрипт", "Ответ"],
  );
  assert.deepEqual(
    nodes[0].children.map(({ name, kind }) => [name, kind]),
    [
      ["Ид", "field"],
      ["Имя", "field"],
      ["Метки", "field"],
      ["Изменить", "method"],
      ["Создать", "method"],
    ],
  );
  assert.equal(nodes[0].children[0].selectionLineNumber, 5);
  assert.equal(nodes[0].children[0].detail, "Ид: Число");
  assert.equal(nodes[0].children[3].children.length, 0);
  assert.equal(nodes[2].children[0].name, "Статус");
});

test("Outline handles comments, anonymous handlers, nested structures, and incomplete edits", () => {
  const nodes = parseElementOutline(`/* структура Нет\nметод Нет() ; */
структура Внешняя
    структура Внутренняя
        пер Поле: Строка
    ;
    метод Первый()
        Роутер.Добавить(метод(Запрос: Строка) -> возврат Запрос;)
    ;
    метод Незаконченный()
    метод Следующий()
    ;
;
`);
  assert.equal(nodes.length, 1);
  assert.deepEqual(
    nodes[0].children.map((node) => node.name),
    ["Внутренняя", "Первый", "Незаконченный", "Следующий"],
  );
  assert.equal(nodes[0].children[0].children[0].name, "Поле");
  assert.equal(nodes[0].children[1].children.length, 0);
});
