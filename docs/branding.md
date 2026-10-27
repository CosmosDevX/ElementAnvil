# Element Anvil

Название выбрано пользователем: Element — целевой язык, Anvil — наковальня как образ рабочего инструмента. Поиск точной фразы не подтвердил доступность товарного знака; юридическая проверка реестров не проводилась.

Иконка создана встроенным инструментом ImageGen, без CLI/API-ключа. Кодовые скобки и янтарная искра на графитовой плитке, без хоррор-мотива и надписей. На этапе генерации использовалось рабочее название Element Forge; изображение не содержит текста, поэтому применяется к окончательному Element Anvil без перерисовки.

- Исходник: `build/element-anvil-master.png`.
- Иконки приложения: `build/icon.png`, `build/icon.ico`.
- Интерфейс: `public/icon.png`.
- Повторная упаковка: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/make-icon.ps1`. Скрипт только изменяет размер исходника, сохраняя прозрачность, и создаёт ICO 16/24/32/48/64/128/256 px.

Точный финальный промпт ImageGen:

```text
Use case: logo-brand. Asset type: finished Windows desktop app icon for Element Forge, a professional code editor for the 1C Element language. Create ONE centered bold original geometric emblem merging two code angle brackets with a small amber diamond spark between them, suggesting a forge shaping code. Clean restrained developer tool, no horror. Flat dark graphite rounded square tile with cool ivory bracket strokes and warm amber central spark, crisp simple geometry, ample margin, legible at 16px, premium contemporary design. Square 1024x1024 composition. No text, no letters, no wordmark, no tools, no anvil illustration, no mockup, no perspective, no extra symbols, no watermark. Avoid resembling the Visual Studio Code ribbon. Transparent outside the rounded square.
```
