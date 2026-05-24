import './style.css'

import { Languages } from 'lucide'

import { BoardScene } from './app/board-scene'
import { loadLanguageCodes, loadLocaleTaskMap, loadObjectPool } from './app/data'
import { createLucideIcon } from './app/icons'
import { createAppLayout } from './app/layout'
import { findPossibleTasks, selectBoardObjects } from './app/tasks'
import type { PlacedObject } from './app/types'
import { randomItem } from './app/utils'

const LANGUAGE_STORAGE_KEY = 'tpr-board.language-code'

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found.')
}

const layout = createAppLayout(app)
const boardScene = new BoardScene(layout.sceneRoot)

const state = {
  languageCodes: [] as string[],
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

function showRandomTask(localeTaskMap: Awaited<ReturnType<typeof loadLocaleTaskMap>>) {
  const availableTasks = findPossibleTasks(state.placedObjects, localeTaskMap)
  setTaskText(availableTasks.length ? randomItem(availableTasks) : '')
}

async function selectLanguage(languageCode: string) {
  const localeTaskMap = await loadLocaleTaskMap(languageCode)

  state.selectedLanguageCode = languageCode
  localStorage.setItem(LANGUAGE_STORAGE_KEY, languageCode)
  updateLanguageButtons()
  showRandomTask(localeTaskMap)
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
  state.selectedLanguageCode = getInitialLanguageCode(languageCodes)

  const localeTaskMap = await loadLocaleTaskMap(state.selectedLanguageCode)
  state.placedObjects = selectBoardObjects(objectPool, localeTaskMap)

  renderLanguageOptions()
  await boardScene.initialize(state.placedObjects)
  showRandomTask(localeTaskMap)
}

init().catch((error) => {
  console.error(error)
})
