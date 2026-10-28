# Выпуск новой версии

1. Обновите версию в package.json и package-lock.json.
2. Выполните npm test, npm run test:appearance и npm run test:hovers; проверьте запуск, LSP, отладку и терминал на установленной среде Элемента.
3. Соберите Portable и Setup: npm run build:win.
4. Вычислите SHA256 обоих EXE и сохраните SHA256SUMS.txt.
5. После проверки отправьте коммит, создайте тег версии и GitHub Release. Приложите Portable, Setup и контрольные суммы.

Исходники редактора распространяются по MIT; уведомления сторонних компонентов сохраняются. Элемент и Java устанавливаются отдельно. Подробнее: [distribution.md](distribution.md).
