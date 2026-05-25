import { defaultModel, updateRecall } from './ebisu'

import type {
  EbisuModel,
  LanguageProgress,
  LearningEvent,
  LearningItem,
  RoundOutcome,
  RoundSelectionMode,
  SentenceLearningItem,
  TaskCandidate,
} from './types'

const DATABASE_NAME = 'tpr-board-learning'
const DATABASE_VERSION = 2
const HOURS_PER_MILLISECOND = 1 / (1000 * 60 * 60)
const LEARNING_EVENTS_STORE = 'learningEvents'
const LEARNING_ITEMS_LANGUAGE_INDEX = 'byLanguageCode'
const LEARNING_ITEMS_STORE = 'learningItems'
const LANGUAGE_PROGRESS_STORE = 'languageProgress'
const MIN_ELAPSED_HOURS = 1 / 3600
const SENTENCE_LEARNING_ITEMS_STORE = 'sentenceLearningItems'

type LearningRecord = {
  correctCount: number
  ebisuModel: EbisuModel
  incorrectCount: number
  key: string
  languageCode: string
  lastReviewedAt: number
  seenCount: number
}

type LearningSnapshot = {
  itemsByObjectName: Map<string, LearningItem>
  progress: LanguageProgress | null
  sentenceItemsByKey: Map<string, SentenceLearningItem>
}

type RecordCompletedRoundParams = {
  activeTask: TaskCandidate
  attemptCount: number
  boardObjectNames: string[]
  completedAt?: number
  difficulty: number
  hadWrongAttempt: boolean
  languageCode: string
  selectionMode: RoundSelectionMode
}

function buildLearningItemKey(languageCode: string, objectName: string) {
  return `${languageCode}:${objectName}`
}

function buildSentenceLearningItemKey(languageCode: string, taskKey: string, textIndex: number) {
  return `${languageCode}:${taskKey}:${textIndex}`
}

function createLearningRecord(
  key: string,
  languageCode: string,
  outcome: RoundOutcome,
  reviewedAt: number,
): LearningRecord {
  return {
    correctCount: outcome === 'correct' ? 1 : 0,
    ebisuModel: defaultModel(24) as EbisuModel,
    incorrectCount: outcome === 'wrong' ? 1 : 0,
    key,
    languageCode,
    lastReviewedAt: reviewedAt,
    seenCount: 1,
  }
}

function createObjectLearningItem(
  languageCode: string,
  objectName: string,
  outcome: RoundOutcome,
  reviewedAt: number,
): LearningItem {
  return {
    ...createLearningRecord(buildLearningItemKey(languageCode, objectName), languageCode, outcome, reviewedAt),
    objectName,
  }
}

function createSentenceLearningItem(
  languageCode: string,
  task: TaskCandidate,
  outcome: RoundOutcome,
  reviewedAt: number,
): SentenceLearningItem {
  return {
    ...createLearningRecord(
      buildSentenceLearningItemKey(languageCode, task.key, task.textIndex),
      languageCode,
      outcome,
      reviewedAt,
    ),
    taskKey: task.key,
    textIndex: task.textIndex,
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

      if (!database.objectStoreNames.contains(SENTENCE_LEARNING_ITEMS_STORE)) {
        const sentenceLearningItems = database.createObjectStore(SENTENCE_LEARNING_ITEMS_STORE, {
          keyPath: 'key',
        })
        sentenceLearningItems.createIndex(LEARNING_ITEMS_LANGUAGE_INDEX, 'languageCode', {
          unique: false,
        })
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

function cloneLearningRecord<T extends LearningRecord>(item: T): T {
  return {
    ...item,
    ebisuModel: [...item.ebisuModel] as EbisuModel,
  }
}

function updateLearningRecord<T extends LearningRecord>(
  item: T,
  outcome: RoundOutcome,
  reviewedAt: number,
): T {
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

async function loadLearningRecordsByKey<T extends LearningRecord>(storeName: string, keys: string[]) {
  if (!keys.length) {
    return []
  }

  const database = await openLearningDatabase()

  try {
    const transaction = database.transaction(storeName, 'readonly')
    const store = transaction.objectStore(storeName)
    const requests = keys.map((key) => requestToPromise(store.get(key)))
    const results = await Promise.all(requests)

    return results.filter((item): item is T => Boolean(item)).map((item) => cloneLearningRecord(item))
  } finally {
    database.close()
  }
}

async function loadLearningItemsForObjects(languageCode: string, objectNames: string[]) {
  const items = await loadLearningRecordsByKey<LearningItem>(
    LEARNING_ITEMS_STORE,
    objectNames.map((objectName) => buildLearningItemKey(languageCode, objectName)),
  )

  return new Map(items.map((item) => [item.objectName, item]))
}

async function loadSentenceLearningItem(languageCode: string, task: TaskCandidate) {
  const items = await loadLearningRecordsByKey<SentenceLearningItem>(SENTENCE_LEARNING_ITEMS_STORE, [
    buildSentenceLearningItemKey(languageCode, task.key, task.textIndex),
  ])

  return items[0] ?? null
}

export async function loadLearningSnapshot(languageCode: string): Promise<LearningSnapshot> {
  const database = await openLearningDatabase()

  try {
    const transaction = database.transaction(
      [LEARNING_ITEMS_STORE, LANGUAGE_PROGRESS_STORE, SENTENCE_LEARNING_ITEMS_STORE],
      'readonly',
    )
    const learningItemsStore = transaction.objectStore(LEARNING_ITEMS_STORE)
    const progressStore = transaction.objectStore(LANGUAGE_PROGRESS_STORE)
    const sentenceLearningItemsStore = transaction.objectStore(SENTENCE_LEARNING_ITEMS_STORE)
    const itemsRequest = learningItemsStore.index(LEARNING_ITEMS_LANGUAGE_INDEX).getAll(languageCode)
    const progressRequest = progressStore.get(languageCode)
    const sentenceItemsRequest = sentenceLearningItemsStore
      .index(LEARNING_ITEMS_LANGUAGE_INDEX)
      .getAll(languageCode)
    const [items, progress, sentenceItems] = await Promise.all([
      requestToPromise(itemsRequest),
      requestToPromise(progressRequest),
      requestToPromise(sentenceItemsRequest),
    ])

    return {
      itemsByObjectName: new Map(
        (items as LearningItem[]).map((item) => [item.objectName, cloneLearningRecord(item)]),
      ),
      progress: (progress as LanguageProgress | undefined) ?? null,
      sentenceItemsByKey: new Map(
        (sentenceItems as SentenceLearningItem[]).map((item) => [item.key, cloneLearningRecord(item)]),
      ),
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
  selectionMode,
}: RecordCompletedRoundParams) {
  const outcome: RoundOutcome = hadWrongAttempt ? 'wrong' : 'correct'
  const touchedObjectNames = [activeTask.sourceName, activeTask.targetName]
  const existingItems = await loadLearningItemsForObjects(languageCode, touchedObjectNames)
  const existingSentenceItem = await loadSentenceLearningItem(languageCode, activeTask)
  const nextItems = touchedObjectNames.map((objectName) => {
    const existingItem = existingItems.get(objectName)

    if (!existingItem) {
      return createObjectLearningItem(languageCode, objectName, outcome, completedAt)
    }

    return updateLearningRecord(existingItem, outcome, completedAt)
  })
  const nextSentenceItem = existingSentenceItem
    ? updateLearningRecord(existingSentenceItem, outcome, completedAt)
    : createSentenceLearningItem(languageCode, activeTask, outcome, completedAt)

  const event: LearningEvent = {
    attemptCount,
    boardObjectNames: [...boardObjectNames],
    completedAt,
    difficulty,
    hadWrongAttempt,
    languageCode,
    selectionMode,
    sourceName: activeTask.sourceName,
    targetName: activeTask.targetName,
    taskKey: activeTask.key,
    taskTextIndex: activeTask.textIndex,
  }

  const progress: LanguageProgress = {
    languageCode,
    lastBoardDifficulty: difficulty,
    lastOutcome: outcome,
  }

  const database = await openLearningDatabase()

  try {
    const transaction = database.transaction(
      [LEARNING_EVENTS_STORE, LEARNING_ITEMS_STORE, LANGUAGE_PROGRESS_STORE, SENTENCE_LEARNING_ITEMS_STORE],
      'readwrite',
    )
    const eventsStore = transaction.objectStore(LEARNING_EVENTS_STORE)
    const itemsStore = transaction.objectStore(LEARNING_ITEMS_STORE)
    const progressStore = transaction.objectStore(LANGUAGE_PROGRESS_STORE)
    const sentenceLearningItemsStore = transaction.objectStore(SENTENCE_LEARNING_ITEMS_STORE)

    eventsStore.add(event)
    nextItems.forEach((item) => {
      itemsStore.put(item)
    })
    progressStore.put(progress)
    sentenceLearningItemsStore.put(nextSentenceItem)

    await transactionToPromise(transaction)
  } finally {
    database.close()
  }
}
