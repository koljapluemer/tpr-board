import { defaultModel, updateRecall } from './ebisu'

import type {
  EbisuModel,
  LanguageProgress,
  LearningEvent,
  LearningItem,
  RoundOutcome,
  TaskCandidate,
} from './types'

const DATABASE_NAME = 'tpr-board-learning'
const DATABASE_VERSION = 1
const HOURS_PER_MILLISECOND = 1 / (1000 * 60 * 60)
const LEARNING_EVENTS_STORE = 'learningEvents'
const LEARNING_ITEMS_LANGUAGE_INDEX = 'byLanguageCode'
const LEARNING_ITEMS_STORE = 'learningItems'
const LANGUAGE_PROGRESS_STORE = 'languageProgress'
const MIN_ELAPSED_HOURS = 1 / 3600

type LearningSnapshot = {
  itemsByObjectName: Map<string, LearningItem>
  progress: LanguageProgress | null
}

type RecordCompletedRoundParams = {
  activeTask: TaskCandidate
  attemptCount: number
  boardObjectNames: string[]
  completedAt?: number
  difficulty: number
  hadWrongAttempt: boolean
  languageCode: string
}

function buildLearningItemKey(languageCode: string, objectName: string) {
  return `${languageCode}:${objectName}`
}

function createDefaultLearningItem(
  languageCode: string,
  objectName: string,
  outcome: RoundOutcome,
  reviewedAt: number,
): LearningItem {
  return {
    correctCount: outcome === 'correct' ? 1 : 0,
    ebisuModel: defaultModel(24) as EbisuModel,
    incorrectCount: outcome === 'wrong' ? 1 : 0,
    key: buildLearningItemKey(languageCode, objectName),
    languageCode,
    lastReviewedAt: reviewedAt,
    objectName,
    seenCount: 1,
  }
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener('success', () => {
      resolve(request.result)
    })
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('IndexedDB request failed.'))
    })
  })
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener('complete', () => {
      resolve()
    })
    transaction.addEventListener('abort', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction aborted.'))
    })
    transaction.addEventListener('error', () => {
      reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
    })
  })
}

function openLearningDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'))
      return
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)

    request.addEventListener('upgradeneeded', () => {
      const database = request.result

      if (!database.objectStoreNames.contains(LEARNING_ITEMS_STORE)) {
        const learningItems = database.createObjectStore(LEARNING_ITEMS_STORE, { keyPath: 'key' })
        learningItems.createIndex(LEARNING_ITEMS_LANGUAGE_INDEX, 'languageCode', { unique: false })
      }

      if (!database.objectStoreNames.contains(LEARNING_EVENTS_STORE)) {
        database.createObjectStore(LEARNING_EVENTS_STORE, { autoIncrement: true, keyPath: 'id' })
      }

      if (!database.objectStoreNames.contains(LANGUAGE_PROGRESS_STORE)) {
        database.createObjectStore(LANGUAGE_PROGRESS_STORE, { keyPath: 'languageCode' })
      }
    })

    request.addEventListener('success', () => {
      resolve(request.result)
    })
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Failed to open IndexedDB.'))
    })
  })
}

function cloneLearningItem(item: LearningItem): LearningItem {
  return {
    ...item,
    ebisuModel: [...item.ebisuModel] as EbisuModel,
  }
}

function updateExistingLearningItem(
  item: LearningItem,
  outcome: RoundOutcome,
  reviewedAt: number,
): LearningItem {
  const elapsedHours = Math.max((reviewedAt - item.lastReviewedAt) * HOURS_PER_MILLISECOND, MIN_ELAPSED_HOURS)
  const success = outcome === 'correct' ? 1 : 0

  return {
    ...item,
    correctCount: item.correctCount + success,
    ebisuModel: updateRecall(item.ebisuModel, success, 1, elapsedHours) as EbisuModel,
    incorrectCount: item.incorrectCount + (success === 0 ? 1 : 0),
    lastReviewedAt: reviewedAt,
    seenCount: item.seenCount + 1,
  }
}

async function loadLearningItemsForObjects(languageCode: string, objectNames: string[]) {
  if (!objectNames.length) {
    return new Map<string, LearningItem>()
  }

  const database = await openLearningDatabase()

  try {
    const transaction = database.transaction(LEARNING_ITEMS_STORE, 'readonly')
    const store = transaction.objectStore(LEARNING_ITEMS_STORE)
    const requests = objectNames.map((objectName) =>
      requestToPromise(store.get(buildLearningItemKey(languageCode, objectName))),
    )
    const results = await Promise.all(requests)

    return new Map(
      results
        .filter((item): item is LearningItem => Boolean(item))
        .map((item) => [item.objectName, cloneLearningItem(item)]),
    )
  } finally {
    database.close()
  }
}

export async function loadLearningSnapshot(languageCode: string): Promise<LearningSnapshot> {
  const database = await openLearningDatabase()

  try {
    const transaction = database.transaction([LEARNING_ITEMS_STORE, LANGUAGE_PROGRESS_STORE], 'readonly')
    const learningItemsStore = transaction.objectStore(LEARNING_ITEMS_STORE)
    const progressStore = transaction.objectStore(LANGUAGE_PROGRESS_STORE)
    const itemsRequest = learningItemsStore.index(LEARNING_ITEMS_LANGUAGE_INDEX).getAll(languageCode)
    const progressRequest = progressStore.get(languageCode)
    const [items, progress] = await Promise.all([
      requestToPromise(itemsRequest),
      requestToPromise(progressRequest),
    ])

    return {
      itemsByObjectName: new Map(
        (items as LearningItem[]).map((item) => [item.objectName, cloneLearningItem(item)]),
      ),
      progress: (progress as LanguageProgress | undefined) ?? null,
    }
  } finally {
    database.close()
  }
}

export async function recordCompletedRound({
  activeTask,
  attemptCount,
  boardObjectNames,
  completedAt = Date.now(),
  difficulty,
  hadWrongAttempt,
  languageCode,
}: RecordCompletedRoundParams) {
  const outcome: RoundOutcome = hadWrongAttempt ? 'wrong' : 'correct'
  const touchedObjectNames = [activeTask.sourceName, activeTask.targetName]
  const existingItems = await loadLearningItemsForObjects(languageCode, touchedObjectNames)
  const nextItems = touchedObjectNames.map((objectName) => {
    const existingItem = existingItems.get(objectName)

    if (!existingItem) {
      return createDefaultLearningItem(languageCode, objectName, outcome, completedAt)
    }

    return updateExistingLearningItem(existingItem, outcome, completedAt)
  })

  const event: LearningEvent = {
    attemptCount,
    boardObjectNames: [...boardObjectNames],
    completedAt,
    difficulty,
    hadWrongAttempt,
    languageCode,
    sourceName: activeTask.sourceName,
    targetName: activeTask.targetName,
    taskKey: activeTask.key,
  }

  const progress: LanguageProgress = {
    languageCode,
    lastBoardDifficulty: difficulty,
    lastOutcome: outcome,
  }

  const database = await openLearningDatabase()

  try {
    const transaction = database.transaction(
      [LEARNING_EVENTS_STORE, LEARNING_ITEMS_STORE, LANGUAGE_PROGRESS_STORE],
      'readwrite',
    )
    const eventsStore = transaction.objectStore(LEARNING_EVENTS_STORE)
    const itemsStore = transaction.objectStore(LEARNING_ITEMS_STORE)
    const progressStore = transaction.objectStore(LANGUAGE_PROGRESS_STORE)

    eventsStore.add(event)
    nextItems.forEach((item) => {
      itemsStore.put(item)
    })
    progressStore.put(progress)

    await transactionToPromise(transaction)
  } finally {
    database.close()
  }
}
