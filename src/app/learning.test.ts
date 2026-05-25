import 'fake-indexeddb/auto'

import { beforeEach, describe, expect, it } from 'vitest'

import { loadLearningSnapshot, recordCompletedRound } from './learning'
import type { TaskCandidate } from './types'

const DATABASE_NAME = 'tpr-board-learning'

function deleteDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)

    request.addEventListener('success', () => {
      resolve()
    })
    request.addEventListener('error', () => {
      reject(request.error ?? new Error('Failed to delete IndexedDB database.'))
    })
    request.addEventListener('blocked', () => {
      reject(new Error('IndexedDB database deletion was blocked.'))
    })
  })
}

function createTaskCandidate(sourceName: string, targetName: string): TaskCandidate {
  return {
    key: `${sourceName}_act_${targetName}`,
    sourceEffect: 'NOTHING',
    sourceName,
    targetEffect: 'NOTHING',
    targetName,
    text: `${sourceName} to ${targetName}`,
    textIndex: 0,
  }
}

beforeEach(async () => {
  await deleteDatabase(DATABASE_NAME)
})

describe('learning storage', () => {
  it('creates learning items, events, and language progress on first exposure', async () => {
    await recordCompletedRound({
      activeTask: createTaskCandidate('table', 'house'),
      attemptCount: 1,
      boardObjectNames: ['table', 'house', 'lamp'],
      completedAt: 10_000,
      difficulty: 1.5,
      hadWrongAttempt: false,
      languageCode: 'eng',
    })

    const snapshot = await loadLearningSnapshot('eng')
    const tableItem = snapshot.itemsByObjectName.get('table')
    const houseItem = snapshot.itemsByObjectName.get('house')

    expect(tableItem).toMatchObject({
      correctCount: 1,
      incorrectCount: 0,
      lastReviewedAt: 10_000,
      objectName: 'table',
      seenCount: 1,
    })
    expect(tableItem?.ebisuModel).toEqual([4, 4, 24])
    expect(houseItem?.ebisuModel).toEqual([4, 4, 24])
    expect(snapshot.progress).toEqual({
      languageCode: 'eng',
      lastBoardDifficulty: 1.5,
      lastOutcome: 'correct',
    })
  })

  it('updates existing items and ebisu metadata on repeated exposure', async () => {
    await recordCompletedRound({
      activeTask: createTaskCandidate('table', 'house'),
      attemptCount: 1,
      boardObjectNames: ['table', 'house'],
      completedAt: 10_000,
      difficulty: 0.3,
      hadWrongAttempt: false,
      languageCode: 'eng',
    })

    await recordCompletedRound({
      activeTask: createTaskCandidate('table', 'house'),
      attemptCount: 2,
      boardObjectNames: ['table', 'house', 'lamp'],
      completedAt: 10_000 + 24 * 60 * 60 * 1000,
      difficulty: 1.5,
      hadWrongAttempt: true,
      languageCode: 'eng',
    })

    const snapshot = await loadLearningSnapshot('eng')
    const tableItem = snapshot.itemsByObjectName.get('table')

    expect(tableItem).toMatchObject({
      correctCount: 1,
      incorrectCount: 1,
      lastReviewedAt: 10_000 + 24 * 60 * 60 * 1000,
      seenCount: 2,
    })
    expect(tableItem?.ebisuModel).not.toEqual([4, 4, 24])
    expect(snapshot.progress?.lastOutcome).toBe('wrong')
  })

  it('keeps language progress isolated per language', async () => {
    await recordCompletedRound({
      activeTask: createTaskCandidate('table', 'house'),
      attemptCount: 1,
      boardObjectNames: ['table', 'house'],
      completedAt: 10_000,
      difficulty: 0.3,
      hadWrongAttempt: false,
      languageCode: 'eng',
    })

    await recordCompletedRound({
      activeTask: createTaskCandidate('table', 'house'),
      attemptCount: 3,
      boardObjectNames: ['table', 'house', 'lamp'],
      completedAt: 20_000,
      difficulty: 1.5,
      hadWrongAttempt: true,
      languageCode: 'deu',
    })

    const [englishSnapshot, germanSnapshot] = await Promise.all([
      loadLearningSnapshot('eng'),
      loadLearningSnapshot('deu'),
    ])

    expect(englishSnapshot.progress).toEqual({
      languageCode: 'eng',
      lastBoardDifficulty: 0.3,
      lastOutcome: 'correct',
    })
    expect(germanSnapshot.progress).toEqual({
      languageCode: 'deu',
      lastBoardDifficulty: 1.5,
      lastOutcome: 'wrong',
    })
    expect(englishSnapshot.itemsByObjectName.get('table')?.languageCode).toBe('eng')
    expect(germanSnapshot.itemsByObjectName.get('table')?.languageCode).toBe('deu')
  })
})
