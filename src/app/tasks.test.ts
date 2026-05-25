import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRelationshipIndex, calculateBoardDifficulty, planRound } from './tasks'
import type {
  LanguageProgress,
  LearningItem,
  LocaleTaskMap,
  ObjectRecord,
  PlacedObject,
} from './types'

function createPlacedObject(name: string, relationships?: ObjectRecord['relationships']): PlacedObject {
  return {
    name,
    record: {
      model: `${name}.glb`,
      relationships,
    },
  }
}

function createSeenLearningItem(languageCode: string, objectName: string): LearningItem {
  return {
    correctCount: 1,
    ebisuModel: [4, 4, 24],
    incorrectCount: 0,
    key: `${languageCode}:${objectName}`,
    languageCode,
    lastReviewedAt: 1,
    objectName,
    seenCount: 1,
  }
}

function createSeenLearningMap(languageCode: string, objectNames: string[]) {
  return new Map(objectNames.map((objectName) => [objectName, createSeenLearningItem(languageCode, objectName)]))
}

function withDeterministicRandom(callback: () => void) {
  const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0)

  try {
    callback()
  } finally {
    randomSpy.mockRestore()
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('calculateBoardDifficulty', () => {
  it('counts all three incorrect-action categories and excludes the correct action', () => {
    const placedObjects = [
      createPlacedObject('a', { b: ['act', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('b', { a: ['return', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('c', { d: ['other', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('d'),
    ]
    const difficulty = calculateBoardDifficulty(placedObjects, {
      key: 'a_act_b',
      sourceEffect: 'NOTHING',
      sourceName: 'a',
      targetEffect: 'NOTHING',
      targetName: 'b',
      text: 'A to B',
      textIndex: 0,
    })

    expect(difficulty.missingRelationshipCount).toBe(9)
    expect(difficulty.unrelatedRelationshipCount).toBe(1)
    expect(difficulty.overlappingRelationshipCount).toBe(1)
    expect(difficulty.total).toBeCloseTo(5.7, 5)
  })
})

describe('createRelationshipIndex', () => {
  it('classifies isolated objects using inbound and outbound relationships', () => {
    const objectPool = [
      createPlacedObject('a', { b: ['act', 'NOTHING', 'NOTHING'], h: ['wave', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('b'),
      createPlacedObject('c'),
      createPlacedObject('d', { e: ['carry', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('e'),
      createPlacedObject('f', { a: ['touch', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('h'),
    ]
    const localeTaskMap: LocaleTaskMap = {
      a_act_b: ['A to B'],
      a_wave_h: ['A to H'],
    }
    const relationshipIndex = createRelationshipIndex(objectPool, localeTaskMap)

    expect(relationshipIndex.isolatedNames).toEqual(['c'])
    expect(relationshipIndex.inboundSourcesByTarget.get('h')).toEqual(new Set(['a']))
    expect(relationshipIndex.outboundTargetsBySource.get('f')).toEqual(new Set(['a']))
  })
})

describe('planRound', () => {
  it('keeps unseen task objects below difficulty 2', () => {
    const objectPool = [
      createPlacedObject('a', { b: ['act', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('b'),
      createPlacedObject('c'),
      createPlacedObject('d'),
    ]
    const localeTaskMap: LocaleTaskMap = {
      a_act_b: ['A to B'],
    }

    withDeterministicRandom(() => {
      const roundPlan = planRound({
        languageProgress: null,
        learningItemsByObjectName: new Map(),
        relationshipIndex: createRelationshipIndex(objectPool, localeTaskMap),
      })

      expect(roundPlan.activeTask.key).toBe('a_act_b')
      expect(roundPlan.difficulty).toBeCloseTo(1.5, 5)
      expect(roundPlan.placedObjects.map(({ name }) => name)).toEqual(['a', 'b', 'c'])
    })
  })

  it('stays strictly below the previous difficulty after a wrong round', () => {
    const objectPool = [
      createPlacedObject('a', { b: ['act', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('b'),
      createPlacedObject('c'),
      createPlacedObject('d'),
      createPlacedObject('e'),
    ]
    const learningItems = createSeenLearningMap('eng', ['a', 'b'])
    const progress: LanguageProgress = {
      languageCode: 'eng',
      lastBoardDifficulty: 3.5,
      lastOutcome: 'wrong',
    }

    withDeterministicRandom(() => {
      const roundPlan = planRound({
        languageProgress: progress,
        learningItemsByObjectName: learningItems,
        relationshipIndex: createRelationshipIndex(objectPool, { a_act_b: ['A to B'] }),
      })

      expect(roundPlan.difficulty).toBeLessThan(3.5)
      expect(roundPlan.difficulty).toBeCloseTo(3.3, 5)
      expect(roundPlan.placedObjects).toHaveLength(4)
    })
  })

  it('exceeds the previous difficulty after a correct round', () => {
    const objectPool = [
      createPlacedObject('a', { b: ['act', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('b'),
      createPlacedObject('c'),
      createPlacedObject('d'),
    ]
    const learningItems = createSeenLearningMap('eng', ['a', 'b'])
    const progress: LanguageProgress = {
      languageCode: 'eng',
      lastBoardDifficulty: 2,
      lastOutcome: 'correct',
    }

    withDeterministicRandom(() => {
      const roundPlan = planRound({
        languageProgress: progress,
        learningItemsByObjectName: learningItems,
        relationshipIndex: createRelationshipIndex(objectPool, { a_act_b: ['A to B'] }),
      })

      expect(roundPlan.difficulty).toBeGreaterThan(2)
      expect(roundPlan.difficulty).toBeCloseTo(3.3, 5)
      expect(roundPlan.placedObjects).toHaveLength(4)
    })
  })

  it('falls back to the closest achievable board when no candidate satisfies the ceiling', () => {
    const objectPool = [
      createPlacedObject('a', { b: ['act', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('b'),
      createPlacedObject('c'),
    ]
    const learningItems = createSeenLearningMap('eng', ['a', 'b'])
    const progress: LanguageProgress = {
      languageCode: 'eng',
      lastBoardDifficulty: 1,
      lastOutcome: 'wrong',
    }

    withDeterministicRandom(() => {
      const roundPlan = planRound({
        languageProgress: progress,
        learningItemsByObjectName: learningItems,
        relationshipIndex: createRelationshipIndex(objectPool, { a_act_b: ['A to B'] }),
      })

      expect(roundPlan.difficulty).toBeCloseTo(0.3, 5)
      expect(roundPlan.placedObjects.map(({ name }) => name)).toEqual(['a', 'b'])
    })
  })

  it('only chooses locale-playable task edges in sparse locales', () => {
    const objectPool = [
      createPlacedObject('a', { b: ['act', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('b'),
      createPlacedObject('x', { y: ['move', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('y'),
      createPlacedObject('z'),
    ]
    const localeTaskMap: LocaleTaskMap = {
      x_move_y: ['X to Y'],
    }

    withDeterministicRandom(() => {
      const roundPlan = planRound({
        languageProgress: null,
        learningItemsByObjectName: new Map(),
        relationshipIndex: createRelationshipIndex(objectPool, localeTaskMap),
      })

      expect(roundPlan.activeTask.key).toBe('x_move_y')
    })
  })

  it('never places duplicate objects on the board', () => {
    const objectPool = [
      createPlacedObject('a', { b: ['act', 'NOTHING', 'NOTHING'] }),
      createPlacedObject('b'),
      createPlacedObject('c'),
      createPlacedObject('d'),
      createPlacedObject('e'),
      createPlacedObject('f'),
    ]

    withDeterministicRandom(() => {
      const roundPlan = planRound({
        languageProgress: {
          languageCode: 'eng',
          lastBoardDifficulty: 5,
          lastOutcome: 'correct',
        },
        learningItemsByObjectName: createSeenLearningMap('eng', ['a', 'b']),
        relationshipIndex: createRelationshipIndex(objectPool, { a_act_b: ['A to B'] }),
      })
      const placedNames = roundPlan.placedObjects.map(({ name }) => name)

      expect(new Set(placedNames).size).toBe(placedNames.length)
    })
  })
})
