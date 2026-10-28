# Element Anvil в Linux

Версия 0.7.1 распространяется для Linux x64 как AppImage и пакет `.deb`. Скачайте файлы и `SHA256SUMS.txt` в [GitHub Releases](https://github.com/CosmosDevX/UnexploredCodeEdtior/releases/tag/v0.7.1).

Проверки выполнены в Debian 12 x64, включая интерфейс в Xvfb, нативный терминал и установленную среду Элемента. Сборки рассчитаны на дистрибутивы с glibc, GTK 3 и локалью UTF-8.

## Без установки: AppImage

```sh
chmod +x ElementAnvil-0.7.1-Linux-x86_64.AppImage
./ElementAnvil-0.7.1-Linux-x86_64.AppImage
```

AppImage использует FUSE. Если в системе его нет, доступен запуск с извлечением:

```sh
./ElementAnvil-0.7.1-Linux-x86_64.AppImage --appimage-extract-and-run
```

## Установка в Debian/Ubuntu

```sh
sudo apt install ./ElementAnvil-0.7.1-Linux-amd64.deb
```

После установки приложение появляется в меню и запускается командой `element-anvil`. Удаление: `sudo apt remove unexplored-editor`.

Запускайте редактор от обычного пользователя. Настройки сохраняются в `${XDG_CONFIG_HOME:-~/.config}/Undertow/`; AppImage использует тот же профиль, что и установленная версия.

## Элемент и Java

Для редактирования файлов отдельная среда не требуется. Для выполнения кода, LSP и отладки установите Java 17 и соответствующие компоненты 1С:Элемент для Linux. Укажите корень установки с `executor/lib` и `ide/resources/app/plugins/@1c-executor-plugin`:

```sh
export ELEMENT_HOME="/путь/к/установке/Элемента"
export JAVA_HOME="/путь/к/jdk-17"
element-anvil
```

Для AppImage запускайте его вместо последней команды. Переменные должны быть доступны процессу редактора; после их изменения перезапустите приложение. В терминале используется оболочка из `SHELL`, по умолчанию Bash. Для Bash при обнаруженной среде добавляется команда `executor`, поддерживающая пути с пробелами.

Java и файлы 1С не входят в сборки редактора. Лицензия редактора не заменяет условия распространения этих компонентов.

## Сборка из исходников

В Linux нужны Node.js 24, npm, Python 3, make и C++-компилятор для `node-pty`. Затем:

```sh
npm ci
npm test
npm run build:linux
```

Готовые AppImage и `.deb` появятся в `release/`. Linux-модуль терминала должен быть собран под Linux той же архитектуры. Windows-зависимости из `node_modules` не подходят.

Для Docker из корня репозитория:

```sh
docker build -f build/Dockerfile.linux -t anvil-builder .
docker run --rm -v "$PWD:/project" -v anvil-linux-deps:/project/node_modules anvil-builder bash -lc 'npm ci && npm run build:linux'
```

Зависимости Linux хранятся в отдельном Docker volume и не меняют Windows `node_modules`. Компилированный Node-API модуль терминала включается в пакет через `scripts/prepare-native.cjs`.
