# Third-party components

Element Anvil's own code is licensed under MIT (see LICENSE). Third-party components retain their respective licenses. This notice does not relicense the 1C runtime, Java, or any other third-party software.

| Component                                                                 | License / included notice                                                                                           |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Electron                                                                  | MIT; LICENSE.electron.txt alongside the executable                                                                  |
| Chromium and Electron's bundled libraries                                 | LICENSES.chromium.html alongside the executable, with individual notices and terms                                  |
| Monaco Editor                                                             | MIT; node_modules/monaco-editor/LICENSE inside resources/app.asar                                                   |
| node-pty and its bundled native components                                | node_modules/node-pty/LICENSE and bundled component notices under resources/app.asar.unpacked/node_modules/node-pty |
| xterm.js                                                                  | MIT; public/terminal-vendor/xterm-LICENSE.txt                                                                       |
| xterm addon-fit                                                           | MIT; public/terminal-vendor/fit-LICENSE.txt                                                                         |
| markdown-it                                                               | MIT; public/markdown/markdown-it-LICENSE.txt                                                                        |
| DOMPurify                                                                 | Apache-2.0 OR MPL-2.0; public/markdown/DOMPurify-LICENSE.txt                                                        |
| Fira Code, IBM Plex Mono, JetBrains Mono, Press Start 2P, Source Code Pro | SIL Open Font License 1.1; individual public/fonts/*-LICENSE.txt files                                              |

Other packaged npm dependencies retain their license files under node_modules in resources/app.asar. Build tools and development dependencies are not part of the editor runtime.

UI icon artwork was generated using OpenAI ImageGen. Prompts and asset paths are recorded in docs/ui-icons.md in the source repository.

1C:Enterprise.Element Script (including executor, LSP and debugger) and Java are installed separately by the user. They are not bundled with Element Anvil. Product names belong to their respective owners; Element Anvil is an independent, unofficial editor.
