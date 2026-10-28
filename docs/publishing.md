# Выпуск новой версии

1. Обновите версию в package.json и package-lock.json.
2. Выполните npm test, npm run test:appearance, npm run test:hovers и npm run test:themes; проверьте запуск, LSP, отладку и терминал на установленной среде Элемента.
3. Соберите Windows Portable и Setup: npm run build:win. В Linux или Docker соберите AppImage и deb: npm run build:linux. Подробнее: [linux.md](linux.md).
4. Вычислите SHA256 всех четырёх файлов и сохраните общий SHA256SUMS.txt.
5. После проверки отправьте коммит, создайте тег версии и GitHub Release. Приложите четыре сборки и контрольные суммы.

Исходники редактора распространяются по MIT; уведомления сторонних компонентов сохраняются. Элемент и Java устанавливаются отдельно. Подробнее: [distribution.md](distribution.md).
