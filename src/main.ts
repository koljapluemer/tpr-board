import './style.css'

import { BarChart3, Languages, Volume2 } from 'lucide'

import { BoardScene } from './app/board-scene'
import { loadLanguageCodes, loadLocaleTaskMap, loadObjectPool } from './app/data'
import { createLucideIcon } from './app/icons'
import { createAppLayout } from './app/layout'
import { createStatsTracker, formatPlayedTime, type PlayerStats } from './app/stats'
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
const statsTracker = createStatsTracker()
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

const taskAudio = {
  availabilityByUrl: new Map<string, Promise<boolean>>(),
  currentUrl: null as string | null,
  element: new Audio(),
  syncToken: 0,
}

layout.languageButton.appendChild(
  createLucideIcon(Languages, { class: 'size-5', width: '20', height: '20' }),
)
layout.statsButton.appendChild(
  createLucideIcon(BarChart3, { class: 'size-5', width: '20', height: '20' }),
)
layout.taskReplayButton.appendChild(
  createLucideIcon(Volume2, { class: 'size-5', width: '20', height: '20' }),
)
layout.languageButton.addEventListener('click', () => {
  layout.languageModal.showModal()
})
layout.statsButton.addEventListener('click', () => {
  updateStatsView(statsTracker.getStats())
  layout.statsModal.showModal()
})
layout.taskReplayButton.addEventListener('click', () => {
  void replayTaskAudio()
})

taskAudio.element.preload = 'auto'

function updateStatsView(stats: PlayerStats) {
  layout.statsTimePlayedValue.textContent = formatPlayedTime(stats.timePlayedMs)
  layout.statsTasksCompletedValue.textContent = String(stats.tasksCompleted)
}

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

function buildTaskAudioUrl(task: TaskCandidate, languageCode: string) {
  return `/tpr-board-data/${languageCode}/${task.key}-${task.textIndex + 1}.mp3`
}

function stopTaskAudio() {
  taskAudio.element.pause()
  taskAudio.element.currentTime = 0
}

function setTaskReplayAvailability(audioUrl: string | null) {
  taskAudio.currentUrl = audioUrl
  layout.taskReplayButton.disabled = !audioUrl
}

async function checkTaskAudioExists(url: string) {
  const headResponse = await fetch(url, { method: 'HEAD' })

  if (headResponse.ok) {
    return true
  }

  if (headResponse.status !== 405 && headResponse.status !== 501) {
    return false
  }

  const getResponse = await fetch(url)
  return getResponse.ok
}

function resolveTaskAudioAvailability(url: string) {
  const cachedAvailability = taskAudio.availabilityByUrl.get(url)

  if (cachedAvailability) {
    return cachedAvailability
  }

  const availabilityPromise = checkTaskAudioExists(url).catch(() => false)
  taskAudio.availabilityByUrl.set(url, availabilityPromise)
  return availabilityPromise
}

async function replayTaskAudio() {
  const audioUrl = taskAudio.currentUrl

  if (!audioUrl) {
    return
  }

  stopTaskAudio()

  if (taskAudio.element.src !== new URL(audioUrl, window.location.href).href) {
    taskAudio.element.src = audioUrl
  }

  try {
    await taskAudio.element.play()
  } catch {
    // Ignore autoplay or decoding failures.
  }
}

async function syncTaskAudio(task: TaskCandidate | null) {
  const syncToken = ++taskAudio.syncToken

  stopTaskAudio()
  setTaskReplayAvailability(null)

  if (!task) {
    return
  }

  const languageCode = state.selectedLanguageCode
  const audioUrl = buildTaskAudioUrl(task, languageCode)
  const audioExists = await resolveTaskAudioAvailability(audioUrl)

  if (syncToken !== taskAudio.syncToken) {
    return
  }

  if (!audioExists) {
    return
  }

  setTaskReplayAvailability(audioUrl)
  await replayTaskAudio()
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
    void syncTaskAudio(null)
    return false
  }

  state.activeTask = randomItem(availableTasks)
  boardScene.setActiveTask(state.activeTask)
  setTaskText(state.activeTask.text)
  void syncTaskAudio(state.activeTask)
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
  updateStatsView(statsTracker.incrementTasksCompleted())
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

  statsTracker.subscribe(updateStatsView)
  renderLanguageOptions()
  await startNewRound()
}

init().catch((error) => {
  console.error(error)
})

window.addEventListener('beforeunload', () => {
  statsTracker.destroy()
})
