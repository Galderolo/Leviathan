# Contributing to Leviathan

Thanks for your interest in Leviathan!

**Please read this first:** Leviathan is currently maintained by a single person in their spare time. Issues and pull requests are welcome, but:

- reviews can take a long time, and some pull requests may never be reviewed or merged;
- for anything bigger than a small fix, open an issue first so you do not spend time on something that will not fit;
- the project is MIT-licensed, so you are always free to fork it and maintain your own version.

Issues and pull requests can be written in English or Spanish.

## Getting started

Requirements: [Node.js](https://nodejs.org) 22.12+ and [Git](https://git-scm.com).

```bash
npm install
npm run dev
```

`npm run dev` opens the app with hot reload for the interface. Changes to the main process (`src/main`) restart the app automatically.

Before opening a pull request, run:

```bash
npm run typecheck
npm test
npm run format     # or format:check to only verify
```

CI runs the same checks on Windows, macOS and Linux.

## How the code is organised

```
src/
  shared/       Pure TypeScript shared by both processes (no Node or DOM APIs)
    types.ts      Data model: commits, refs, status, diffs, settings
    api.ts        The contract between the interface and the main process
    parsers.ts    Parsers for git's machine-readable output
    graph.ts      Lane-assignment algorithm for the commit graph
  main/         Electron main process (Node.js)
    git/runner.ts      Spawns git safely (argument arrays, never a shell)
    git/repository.ts  Every git operation Leviathan performs
    ipc.ts             Maps API methods to repository functions
    watcher.ts         Watches repositories for changes on disk
    settings.ts        Persists settings to the user data folder
  preload/      Exposes the API to the interface (contextIsolation + sandbox)
  renderer/     React interface
    src/store.ts       Application state (zustand)
    src/actions.ts     Everything the UI can do; calls the API and refreshes state
    src/menus.ts       Context menus
    src/components/    UI components
    src/i18n/          Translations
tests/          Vitest unit and integration tests
```

Leviathan shells out to the user's own `git` executable instead of re-implementing Git. That keeps behaviour identical to the command line and makes user configuration, credential helpers and SSH keys work without extra effort.

### Adding a new git operation

1. Implement it in `src/main/git/repository.ts`. Validate user-provided values (see `assertSafeArg` and `assertBranchName`) and always pass arguments as an array.
2. Add a test in `tests/repository.test.ts`. The tests run real git commands against temporary repositories.
3. Add the method signature to `LeviathanInvokeApi` in `src/shared/api.ts` **and** to the `METHODS` map below it (the compiler reminds you).
4. Wire it in `src/main/ipc.ts`.
5. Add an action in `src/renderer/src/actions.ts` (use `runOp` so errors become toasts and the repository refreshes), then call it from a button or a menu in `menus.ts`.

### Translations

All interface text lives in `src/renderer/src/i18n/`. `en.ts` is the source of truth; every other language must define the same keys, and TypeScript fails the build if one is missing.

- To add a string: add the key to `en.ts` and `es.ts`, then use `t('my.key')` (or `useT()` inside components).
- For singular forms add a `key_one` variant; it is used when `count` is 1.
- To add a language: copy `es.ts`, translate it, and register it in `i18n/index.ts` (`dictionaries` and `LANGUAGES`).

### Styling

The interface uses plain CSS in `src/renderer/src/styles/app.css`. Colours are CSS variables on `:root`, so a new theme only needs to override them. Icons come from [lucide](https://lucide.dev).

## Pull request guidelines

- Keep pull requests focused: one feature or fix per PR.
- Describe what changes and how you tested it. Add screenshots for visual changes.
- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org) where possible (`feat: ...`, `fix: ...`, `docs: ...`).
- Be kind in reviews. See the [Code of Conduct](CODE_OF_CONDUCT.md).

## Troubleshooting

- **`TypeError: Cannot read properties of undefined (reading 'isPackaged')` when starting the app**: the environment variable `ELECTRON_RUN_AS_NODE` is set (some editors set it for their own processes), which makes Electron behave like plain Node. Unset it before running `npm run dev`.
- **Use a separate profile while developing**: set `LEVIATHAN_USER_DATA` to any folder and Leviathan stores its settings there instead of your real profile.
- **Developer tools**: press `F12` or `Ctrl+Shift+I` in the app window.
