type AppLayout = {
  currentLanguageText: HTMLParagraphElement
  languageButton: HTMLButtonElement
  languageModalActions: HTMLDivElement
  languageModalBackdrop: HTMLFormElement
  languageModal: HTMLDialogElement
  languageOptions: HTMLDivElement
  sceneRoot: HTMLDivElement
  statsBestStreakValue: HTMLParagraphElement
  statsButton: HTMLButtonElement
  statsModal: HTMLDialogElement
  statsTasksCompletedValue: HTMLParagraphElement
  statsTimePlayedValue: HTMLParagraphElement
  streakBarCurrentFill: HTMLSpanElement
  streakBarRecordFill: HTMLSpanElement
  streakIcon: HTMLSpanElement
  streakIndicator: HTMLDivElement
  streakValue: HTMLSpanElement
  taskReplayButton: HTMLButtonElement
  taskText: HTMLHeadingElement
}

function queryRequiredElement<T extends Element>(parent: ParentNode, selector: string) {
  const element = parent.querySelector<T>(selector)

  if (!element) {
    throw new Error(`Required element not found: ${selector}`)
  }

  return element
}

export function createAppLayout(app: HTMLDivElement, options: { explainImageSrc: string }): AppLayout {
  app.innerHTML = `
    <div id="layout" class="flex h-full w-full flex-col" data-theme="light">
      <div class="flex min-h-0 min-w-0 flex-1">
        <aside class="flex w-16 shrink-0 flex-col items-center gap-2 border-r border-base-300 bg-base-100/80 p-3 backdrop-blur">
          <button
            id="language-button"
            type="button"
            class="btn btn-square btn-ghost"
            aria-label="Choose language"
            aria-haspopup="dialog"
          ></button>
          <button
            id="stats-button"
            type="button"
            class="btn btn-square btn-ghost"
            aria-label="Show stats"
            aria-haspopup="dialog"
          ></button>
        </aside>
        <div class="flex min-w-0 flex-1 flex-col">
          <section id="streak-panel" class="px-8 pt-5 pb-2">
            <div class="mx-auto flex max-w-5xl items-center gap-3">
              <div
                id="streak-bar"
                class="relative h-2 flex-1 overflow-hidden rounded-full bg-base-300/55"
                aria-hidden="true"
              >
                <span
                  id="streak-bar-current-fill"
                  class="absolute inset-y-0 left-0 w-0 rounded-full transition-[width,background-color,opacity] duration-300"
                ></span>
                <span
                  id="streak-bar-record-fill"
                  class="absolute inset-y-0 left-0 w-0 rounded-full transition-[width,background-color,opacity] duration-300"
                ></span>
              </div>
              <div
                id="streak-indicator"
                class="flex shrink-0 items-center gap-1.5 text-sm font-semibold tabular-nums text-base-content/70 transition-colors duration-300"
              >
                <span id="streak-icon" class="flex items-center text-amber-500/85"></span>
                <span id="streak-value">0</span>
              </div>
            </div>
          </section>
          <section id="task-panel" class="px-8 pt-7 pb-4 text-center">
            <div class="relative mx-auto max-w-5xl">
              <h1 id="task-text" class="mx-auto min-h-[1.1em] max-w-5xl pr-14 text-4xl font-extrabold leading-none text-balance md:text-6xl"></h1>
              <button
                id="task-replay-button"
                type="button"
                class="btn btn-square btn-ghost absolute top-0 right-0"
                aria-label="Replay task audio"
                title="Replay task audio"
                disabled
              ></button>
            </div>
          </section>
          <div id="scene" class="min-h-0 flex-1"></div>
        </div>
      </div>
      <footer class="border-t border-base-300 bg-base-100/85 px-4 py-3 text-center text-xs leading-relaxed text-base-content/70 backdrop-blur">
        <p class="mx-auto max-w-5xl text-balance">
          Made by
          <a
            href="https://koljasam.com/"
            target="_blank"
            rel="noreferrer"
            class="font-medium text-base-content underline decoration-base-content/30 underline-offset-3 transition hover:decoration-base-content"
          >
            Kolja Sam
          </a>.
          I am tracking nothing but page views with the privacy friendly
          <a
            href="https://www.goatcounter.com/"
            target="_blank"
            rel="noreferrer"
            class="font-medium text-base-content underline decoration-base-content/30 underline-offset-3 transition hover:decoration-base-content"
          >
            goatcounter
          </a>.
          You can support me building more like this on
          <a
            href="https://ko-fi.com/S6S81CWUVD"
            target="_blank"
            rel="noreferrer"
            class="font-medium text-base-content underline decoration-base-content/30 underline-offset-3 transition hover:decoration-base-content"
          >
            Ko-fi
          </a>.
          Functional cookies only.
        </p>
      </footer>
      <dialog id="language-modal" class="modal">
        <div class="modal-box max-h-[calc(100vh-4rem)] max-w-2xl overflow-y-auto">
          <div class="mb-4">
            <h2 class="text-lg font-semibold">Learning language</h2>
            <p id="current-language-text" class="text-sm text-base-content/70"></p>
          </div>
          <section class="mb-5 rounded-box bg-base-200/70 p-4">
            <div class="grid gap-4 md:grid-cols-[minmax(0,1fr)_11rem] md:items-center">
              <div>
                <h3 class="text-base font-semibold">How to play</h3>
                <p class="mt-2 text-sm leading-6 text-base-content/75">
                  Listen to the spoken instruction, then drag the objects on the board to act it out.
                </p>
                <p class="mt-2 text-sm leading-6 text-base-content/75">
                  Finish the action correctly to get the next task. You can replay the audio any time with the speaker button.
                </p>
              </div>
              <img
                src="${options.explainImageSrc}"
                alt="Example board showing draggable objects during a task"
                class="h-36 w-full rounded-xl object-cover shadow-sm md:h-32"
              />
            </div>
          </section>
          <div class="mb-3">
            <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-base-content/55">Choose language</h3>
          </div>
          <div id="language-options" class="flex flex-col gap-2"></div>
          <div id="language-modal-actions" class="modal-action">
            <form method="dialog">
              <button type="submit" class="btn">Close</button>
            </form>
          </div>
        </div>
        <form id="language-modal-backdrop" method="dialog" class="modal-backdrop">
          <button type="submit">close</button>
        </form>
      </dialog>
      <dialog id="stats-modal" class="modal">
        <div class="modal-box">
          <div class="mb-4">
            <h2 class="text-lg font-semibold">Stats</h2>
            <p class="text-sm text-base-content/70">Stored locally on this device.</p>
          </div>
          <dl class="flex flex-col gap-4">
            <div class="rounded-box bg-base-200/70 px-4 py-3">
              <dt class="text-sm text-base-content/70">Time played</dt>
              <dd id="stats-time-played" class="text-2xl font-semibold">0m</dd>
            </div>
            <div class="rounded-box bg-base-200/70 px-4 py-3">
              <dt class="text-sm text-base-content/70">Tasks completed</dt>
              <dd id="stats-tasks-completed" class="text-2xl font-semibold">0</dd>
            </div>
            <div class="rounded-box bg-base-200/70 px-4 py-3">
              <dt class="text-sm text-base-content/70">Best streak</dt>
              <dd id="stats-best-streak" class="text-2xl font-semibold">0</dd>
            </div>
          </dl>
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
    languageModalActions: queryRequiredElement<HTMLDivElement>(app, '#language-modal-actions'),
    languageModalBackdrop: queryRequiredElement<HTMLFormElement>(app, '#language-modal-backdrop'),
    languageModal: queryRequiredElement<HTMLDialogElement>(app, '#language-modal'),
    languageOptions: queryRequiredElement<HTMLDivElement>(app, '#language-options'),
    sceneRoot: queryRequiredElement<HTMLDivElement>(app, '#scene'),
    statsBestStreakValue: queryRequiredElement<HTMLParagraphElement>(app, '#stats-best-streak'),
    statsButton: queryRequiredElement<HTMLButtonElement>(app, '#stats-button'),
    statsModal: queryRequiredElement<HTMLDialogElement>(app, '#stats-modal'),
    statsTasksCompletedValue: queryRequiredElement<HTMLParagraphElement>(app, '#stats-tasks-completed'),
    statsTimePlayedValue: queryRequiredElement<HTMLParagraphElement>(app, '#stats-time-played'),
    streakBarCurrentFill: queryRequiredElement<HTMLSpanElement>(app, '#streak-bar-current-fill'),
    streakBarRecordFill: queryRequiredElement<HTMLSpanElement>(app, '#streak-bar-record-fill'),
    streakIcon: queryRequiredElement<HTMLSpanElement>(app, '#streak-icon'),
    streakIndicator: queryRequiredElement<HTMLDivElement>(app, '#streak-indicator'),
    streakValue: queryRequiredElement<HTMLSpanElement>(app, '#streak-value'),
    taskReplayButton: queryRequiredElement<HTMLButtonElement>(app, '#task-replay-button'),
    taskText: queryRequiredElement<HTMLHeadingElement>(app, '#task-text'),
  }
}
