type AppLayout = {
  currentLanguageText: HTMLParagraphElement
  languageButton: HTMLButtonElement
  languageModal: HTMLDialogElement
  languageOptions: HTMLDivElement
  sceneRoot: HTMLDivElement
  taskText: HTMLHeadingElement
}

function queryRequiredElement<T extends Element>(parent: ParentNode, selector: string) {
  const element = parent.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Required element not found: ${selector}`)
  }

  return element
}

export function createAppLayout(app: HTMLDivElement): AppLayout {
  app.innerHTML = `
    <div id="layout" class="h-full w-full" data-theme="light">
      <div class="flex h-full min-w-0">
        <aside class="flex w-16 shrink-0 items-start justify-center border-r border-base-300 bg-base-100/80 p-3 backdrop-blur">
          <button
            id="language-button"
            type="button"
            class="btn btn-square btn-ghost"
            aria-label="Choose language"
            aria-haspopup="dialog"
          ></button>
        </aside>
        <div class="flex min-w-0 flex-1 flex-col">
          <section id="task-panel" class="px-8 pt-7 pb-4 text-center">
            <h1 id="task-text" class="mx-auto min-h-[1.1em] max-w-5xl text-4xl font-extrabold leading-none text-balance md:text-6xl"></h1>
          </section>
          <div id="scene" class="min-h-0 flex-1"></div>
        </div>
      </div>
      <dialog id="language-modal" class="modal">
        <div class="modal-box">
          <div class="mb-4">
            <h2 class="text-lg font-semibold">Learning language</h2>
            <p id="current-language-text" class="text-sm text-base-content/70"></p>
          </div>
          <div id="language-options" class="flex flex-col gap-2"></div>
          <div class="modal-action">
            <form method="dialog">
              <button type="submit" class="btn">Close</button>
            </form>
          </div>
        </div>
        <form method="dialog" class="modal-backdrop">
          <button type="submit">close</button>
        </form>
      </dialog>
    </div>
  `

  return {
    currentLanguageText: queryRequiredElement<HTMLParagraphElement>(app, '#current-language-text'),
    languageButton: queryRequiredElement<HTMLButtonElement>(app, '#language-button'),
    languageModal: queryRequiredElement<HTMLDialogElement>(app, '#language-modal'),
    languageOptions: queryRequiredElement<HTMLDivElement>(app, '#language-options'),
    sceneRoot: queryRequiredElement<HTMLDivElement>(app, '#scene'),
    taskText: queryRequiredElement<HTMLHeadingElement>(app, '#task-text'),
  }
}
