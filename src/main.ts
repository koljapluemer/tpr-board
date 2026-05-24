import './style.css'

import { Languages } from 'lucide'

import { BoardScene } from './app/board-scene'
import { loadLanguageCodes, loadLocaleTaskMap, loadObjectPool } from './app/data'
import { createLucideIcon } from './app/icons'
import { createAppLayout } from './app/layout'
import { findTaskCandidates, selectBoardObjects } from './app/tasks'
import type { LocaleTaskMap, PlacedObject, TaskCandidate } from './app/types'
import { randomItem } from './app/utils'

const LANGUAGE_STORAGE_KEY = 'tpr-board.language-code'
const ROUND_SUCCESS_DELAY_MS = 600

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found.')
}

const layout = createAppLayout(app)
const boardScene = new BoardScene(layout.sceneRoot, {
  onTaskCompleted: () => {
    void handleTaskCompleted()
  },
})

const state = {
  activeTask: null as TaskCandidate | null,
  isTransitioningRound: false,
  languageCodes: [] as string[],
  localeTaskMap: {} as LocaleTaskMap,
  objectPool: [] as PlacedObject[],
  placedObjects: [] as PlacedObject[],
  selectedLanguageCode: '',
}

layout.languageButton.appendChild(
  createLucideIcon(Languages, { class: 'size-5', width: '20', height: '20' }),
)
layout.languageButton.addEventListener('click', () => {
  layout.languageModal.showModal()
})

function getInitialLanguageCode(languageCodes: string[]) {
  if (!languageCodes.length) {
    throw new Error('No language codes were found.')
  }

  const savedLanguageCode = localStorage.getItem(LANGUAGE_STORAGE_KEY)

  if (savedLanguageCode && languageCodes.includes(savedLanguageCode)) {
    return savedLanguageCode
  }

  return languageCodes[0]
}

function setTaskText(task: string) {
  layout.taskText.textContent = task
}

function setTaskSuccess(isSuccess: boolean) {
  layout.taskText.classList.toggle('text-green-600', isSuccess)
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function updateLanguageButtons() {
  layout.currentLanguageText.textContent = `Current: ${state.selectedLanguageCode}`
  layout.languageButton.title = `Learning language: ${state.selectedLanguageCode}`

  const buttons = layout.languageOptions.querySelectorAll<HTMLButtonElement>('button[data-language-code]')

  buttons.forEach((button) => {
    const isSelected = button.dataset.languageCode === state.selectedLanguageCode
    button.classList.toggle('btn-primary', isSelected)
    button.classList.toggle('btn-outline', !isSelected)
    button.setAttribute('aria-pressed', String(isSelected))
  })
}

function pickTaskForCurrentBoard() {
  const availableTasks = findTaskCandidates(state.placedObjects, state.localeTaskMap)

  if (!availableTasks.length) {
    state.activeTask = null
    boardScene.setActiveTask(null)
    setTaskText('')
    return false
  }

  state.activeTask = randomItem(availableTasks)
  boardScene.setActiveTask(state.activeTask)
  setTaskText(state.activeTask.text)
  return true
}

async function startNewRound() {
  state.placedObjects = selectBoardObjects(state.objectPool, state.localeTaskMap)
  setTaskSuccess(false)
  await boardScene.initialize(state.placedObjects)

  if (!pickTaskForCurrentBoard()) {
    throw new Error('Failed to select a task for the current board.')
  }
}

async function handleTaskCompleted() {
  if (state.isTransitioningRound) {
    return
  }

  state.isTransitioningRound = true
  setTaskSuccess(true)

  try {
    await delay(ROUND_SUCCESS_DELAY_MS)
    await startNewRound()
  } finally {
    state.isTransitioningRound = false
  }
}

async function selectLanguage(languageCode: string) {
  state.localeTaskMap = await loadLocaleTaskMap(languageCode)
  state.selectedLanguageCode = languageCode
  localStorage.setItem(LANGUAGE_STORAGE_KEY, languageCode)
  updateLanguageButtons()

  if (!state.isTransitioningRound) {
    setTaskSuccess(false)

    if (!pickTaskForCurrentBoard()) {
      await startNewRound()
    }
  }

  layout.languageModal.close()
}

function renderLanguageOptions() {
  layout.languageOptions.replaceChildren(
    ...state.languageCodes.map((languageCode) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.languageCode = languageCode
      button.className = 'btn w-full justify-start'
      button.textContent = languageCode
      button.addEventListener('click', () => {
        void selectLanguage(languageCode)
      })
      return button
    }),
  )

  updateLanguageButtons()
}

async function init() {
  const [languageCodes, objectPool] = await Promise.all([loadLanguageCodes(), loadObjectPool()])

  state.languageCodes = languageCodes
  state.objectPool = objectPool
  state.selectedLanguageCode = getInitialLanguageCode(languageCodes)
  state.localeTaskMap = await loadLocaleTaskMap(state.selectedLanguageCode)

  renderLanguageOptions()
  await startNewRound()
}

init().catch((error) => {
  console.error(error)
})
