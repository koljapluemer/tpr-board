import { predictRecall } from './ebisu'
import type {
  DifficultyBreakdown,
  DifficultyTarget,
  LanguageProgress,
  LearningItem,
  LocaleTaskMap,
  ObjectRecord,
  PlacedObject,
  PlayableRelationship,
  RelationshipDefinition,
  RelationshipIndex,
  RoundPlan,
  RoundSelectionMode,
  SentenceLearningItem,
  TaskCandidate,
} from './types'
import { randomItem, shuffled } from './utils'

const BOARD_CAPACITY = 9
const HOURS_PER_MILLISECOND = 1 / (1000 * 60 * 60)
const MISSING_RELATIONSHIP_DIFFICULTY = 0.3
const OVERLAPPING_RELATIONSHIP_DIFFICULTY = 2
const REVIEW_MODE_PROBABILITY = 0.5
const REVIEW_RECALL_THRESHOLD = 0.8
const UNRELATED_RELATIONSHIP_DIFFICULTY = 1

type CandidateClass = 'isolated' | 'non-overlap' | 'overlap'

type CandidateSimulation = {
  candidate: PlacedObject
  difficulty: number
  difficultyBreakdown: DifficultyBreakdown
}

type PlanRoundOptions = {
  languageProgress: LanguageProgress | null
  learningItemsByObjectName: Map<string, LearningItem>
  relationshipIndex: RelationshipIndex
  sentenceItemsByKey: Map<string, SentenceLearningItem>
}

type TaskSelection = {
  activeTask: TaskCandidate
  reviewPredictedRecall: number | null
  selectionMode: RoundSelectionMode
}

type ReviewTaskCandidate = {
  predictedRecall: number
  task: TaskCandidate
}

function createTaskCandidate(edge: PlayableRelationship, textIndex: number): TaskCandidate {
  return {
    key: edge.key,
    sourceEffect: edge.sourceEffect,
    sourceName: edge.sourceName,
    targetEffect: edge.targetEffect,
    targetName: edge.targetName,
    text: edge.formulations[textIndex],
    textIndex,
  }
}

function resolveTaskCandidate(relationshipIndex: RelationshipIndex, taskKey: string, textIndex: number) {
  const edge = relationshipIndex.playableEdgesByKey.get(taskKey)

  if (!edge || textIndex < 0 || textIndex >= edge.formulations.length) {
    return null
  }

  return createTaskCandidate(edge, textIndex)
}

function findPlayableRelationship(
  sourceName: string,
  targetName: string,
  relationship: RelationshipDefinition,
  localeTaskMap: LocaleTaskMap,
): PlayableRelationship | null {
  const [verb, sourceEffect, targetEffect] = relationship
  const key = `${sourceName}_${verb}_${targetName}`
  const formulations = localeTaskMap[key]?.filter(Boolean) ?? []

  if (!formulations.length) {
    return null
  }

  return {
    formulations,
    key,
    sourceEffect,
    sourceName,
    targetEffect,
    targetName,
  }
}

export function createRelationshipIndex(
  objectPool: PlacedObject[],
  localeTaskMap: LocaleTaskMap,
): RelationshipIndex {
  const inboundSourcesByTarget = new Map<string, Set<string>>()
  const objectByName = new Map(objectPool.map((objectRecord) => [objectRecord.name, objectRecord]))
  const outboundTargetsBySource = new Map<string, Set<string>>()
  const playableEdgesByKey = new Map<string, PlayableRelationship>()
  const playableEdgesBySource = new Map<string, PlayableRelationship[]>()
  let skippedMissingTargetCount = 0
  const skippedMissingTargetSamples: string[] = []

  objectPool.forEach(({ name, record }) => {
    const outboundTargets = new Set<string>()
    const playableEdges: PlayableRelationship[] = []

    Object.entries(record.relationships ?? {}).forEach(([targetName, relationship]) => {
      if (!objectByName.has(targetName)) {
        skippedMissingTargetCount += 1

        if (skippedMissingTargetSamples.length < 5) {
          skippedMissingTargetSamples.push(`${name} -> ${targetName}`)
        }

        return
      }

      outboundTargets.add(targetName)

      if (!inboundSourcesByTarget.has(targetName)) {
        inboundSourcesByTarget.set(targetName, new Set())
      }

      inboundSourcesByTarget.get(targetName)!.add(name)

      const playableRelationship = findPlayableRelationship(
        name,
        targetName,
        relationship,
        localeTaskMap,
      )

      if (playableRelationship) {
        playableEdges.push(playableRelationship)
        playableEdgesByKey.set(playableRelationship.key, playableRelationship)
      }
    })

    outboundTargetsBySource.set(name, outboundTargets)

    if (playableEdges.length > 0) {
      playableEdgesBySource.set(name, playableEdges)
    }
  })

  const isolatedNames = objectPool
    .filter(({ name }) => {
      const hasOutboundRelationships = (outboundTargetsBySource.get(name)?.size ?? 0) > 0
      const hasInboundRelationships = (inboundSourcesByTarget.get(name)?.size ?? 0) > 0
      return !hasOutboundRelationships && !hasInboundRelationships
    })
    .map(({ name }) => name)

  if (skippedMissingTargetCount > 0) {
    console.warn('[relationship-index] skipped relationships whose targets are missing from the object pool', {
      count: skippedMissingTargetCount,
      samples: skippedMissingTargetSamples,
    })
  }

  return {
    inboundSourcesByTarget,
    isolatedNames,
    objectByName,
    playableEdgesByKey,
    outboundTargetsBySource,
    playableEdgesBySource,
    playableSourceNames: [...playableEdgesBySource.keys()],
  }
}

function touchesCorrectTaskObjects(
  objectName: string,
  relationshipIndex: RelationshipIndex,
  correctTask: TaskCandidate,
) {
  if (objectName === correctTask.sourceName || objectName === correctTask.targetName) {
    return true
  }

  const inboundSources = relationshipIndex.inboundSourcesByTarget.get(objectName)
  const outboundTargets = relationshipIndex.outboundTargetsBySource.get(objectName)

  return (
    inboundSources?.has(correctTask.sourceName) === true ||
    inboundSources?.has(correctTask.targetName) === true ||
    outboundTargets?.has(correctTask.sourceName) === true ||
    outboundTargets?.has(correctTask.targetName) === true
  )
}

function classifyCandidate(
  objectName: string,
  relationshipIndex: RelationshipIndex,
  correctTask: TaskCandidate,
): CandidateClass {
  if (relationshipIndex.isolatedNames.includes(objectName)) {
    return 'isolated'
  }

  if (touchesCorrectTaskObjects(objectName, relationshipIndex, correctTask)) {
    return 'overlap'
  }

  return 'non-overlap'
}

function chooseRandomTask(relationshipIndex: RelationshipIndex) {
  if (!relationshipIndex.playableSourceNames.length) {
    throw new Error('No locale-playable relationships were found.')
  }

  const sourceName = randomItem(relationshipIndex.playableSourceNames)
  const playableEdges = relationshipIndex.playableEdgesBySource.get(sourceName)

  if (!playableEdges?.length) {
    throw new Error(`No playable relationships were found for source object: ${sourceName}`)
  }

  const edge = randomItem(playableEdges)
  const textIndex = Math.floor(Math.random() * edge.formulations.length)

  return createTaskCandidate(edge, textIndex)
}

function toReviewTaskCandidate(
  relationshipIndex: RelationshipIndex,
  sentenceItem: SentenceLearningItem,
  reviewedAt: number,
) {
  if (sentenceItem.seenCount <= 0) {
    return null
  }

  const task = resolveTaskCandidate(relationshipIndex, sentenceItem.taskKey, sentenceItem.textIndex)

  if (!task) {
    return null
  }

  const elapsedHours = Math.max((reviewedAt - sentenceItem.lastReviewedAt) * HOURS_PER_MILLISECOND, 0)
  const predictedRecall = predictRecall(sentenceItem.ebisuModel, elapsedHours, true)

  if (predictedRecall >= REVIEW_RECALL_THRESHOLD) {
    return null
  }

  return {
    predictedRecall,
    task,
  } satisfies ReviewTaskCandidate
}

function chooseSentenceReviewTask(
  relationshipIndex: RelationshipIndex,
  sentenceItemsByKey: Map<string, SentenceLearningItem>,
  reviewedAt = Date.now(),
) {
  const eligibleTasks = [...sentenceItemsByKey.values()]
    .map((sentenceItem) => toReviewTaskCandidate(relationshipIndex, sentenceItem, reviewedAt))
    .filter((task): task is ReviewTaskCandidate => task !== null)

  if (!eligibleTasks.length) {
    return null
  }

  return randomItem(eligibleTasks)
}

function selectTask(
  relationshipIndex: RelationshipIndex,
  sentenceItemsByKey: Map<string, SentenceLearningItem>,
): TaskSelection {
  if (Math.random() < REVIEW_MODE_PROBABILITY) {
    const reviewTask = chooseSentenceReviewTask(relationshipIndex, sentenceItemsByKey)

    if (reviewTask) {
      return {
        activeTask: reviewTask.task,
        reviewPredictedRecall: reviewTask.predictedRecall,
        selectionMode: 'sentence-review',
      }
    }
  }

  return {
    activeTask: chooseRandomTask(relationshipIndex),
    reviewPredictedRecall: null,
    selectionMode: 'random',
  }
}

function isCorrectAction(sourceName: string, targetName: string, correctTask: TaskCandidate) {
  return sourceName === correctTask.sourceName && targetName === correctTask.targetName
}

export function calculateBoardDifficulty(
  placedObjects: PlacedObject[],
  correctTask: TaskCandidate,
): DifficultyBreakdown {
  let missingRelationshipCount = 0
  let overlappingRelationshipCount = 0
  let unrelatedRelationshipCount = 0

  placedObjects.forEach((sourceObject) => {
    placedObjects.forEach((targetObject) => {
      if (sourceObject.name === targetObject.name) {
        return
      }

      if (isCorrectAction(sourceObject.name, targetObject.name, correctTask)) {
        return
      }

      const relationship = sourceObject.record.relationships?.[targetObject.name]

      if (!relationship) {
        missingRelationshipCount += 1
        return
      }

      if (
        sourceObject.name === correctTask.sourceName ||
        sourceObject.name === correctTask.targetName ||
        targetObject.name === correctTask.sourceName ||
        targetObject.name === correctTask.targetName
      ) {
        overlappingRelationshipCount += 1
        return
      }

      unrelatedRelationshipCount += 1
    })
  })

  const missingRelationshipDifficulty = missingRelationshipCount * MISSING_RELATIONSHIP_DIFFICULTY
  const overlappingRelationshipDifficulty =
    overlappingRelationshipCount * OVERLAPPING_RELATIONSHIP_DIFFICULTY
  const unrelatedRelationshipDifficulty =
    unrelatedRelationshipCount * UNRELATED_RELATIONSHIP_DIFFICULTY

  return {
    missingRelationshipCount,
    missingRelationshipDifficulty,
    overlappingRelationshipCount,
    overlappingRelationshipDifficulty,
    total:
      missingRelationshipDifficulty +
      overlappingRelationshipDifficulty +
      unrelatedRelationshipDifficulty,
    unrelatedRelationshipCount,
    unrelatedRelationshipDifficulty,
  }
}

function resolveDifficultyRule(
  activeTask: TaskCandidate,
  learningItemsByObjectName: Map<string, LearningItem>,
  languageProgress: LanguageProgress | null,
): DifficultyTarget {
  const sourceItem = learningItemsByObjectName.get(activeTask.sourceName)
  const targetItem = learningItemsByObjectName.get(activeTask.targetName)

  if (!sourceItem || !targetItem) {
    return {
      kind: 'ceiling',
      reason: 'One or both task objects are new to the player, so difficulty must stay below 2.',
      value: 2,
    }
  }

  if (!languageProgress) {
    return {
      kind: 'floor',
      reason: 'Both task objects have been seen, but there is no previous round for this language yet, so start from a floor of 0.',
      value: 0,
    }
  }

  if (languageProgress.lastOutcome === 'wrong') {
    return {
      kind: 'ceiling',
      reason: `The previous ${languageProgress.languageCode} round was wrong, so difficulty must stay below the last board difficulty of ${languageProgress.lastBoardDifficulty}.`,
      value: languageProgress.lastBoardDifficulty,
    }
  }

  return {
    kind: 'floor',
    reason: `The previous ${languageProgress.languageCode} round was correct, so difficulty must exceed the last board difficulty of ${languageProgress.lastBoardDifficulty}.`,
    value: languageProgress.lastBoardDifficulty,
  }
}

function collectCandidateNames(
  relationshipIndex: RelationshipIndex,
  correctTask: TaskCandidate,
  selectedNames: Set<string>,
) {
  const candidateNamesByClass = new Map<CandidateClass, string[]>([
    ['isolated', []],
    ['non-overlap', []],
    ['overlap', []],
  ])

  relationshipIndex.objectByName.forEach((objectRecord, objectName) => {
    if (selectedNames.has(objectName)) {
      return
    }

    const candidateClass = classifyCandidate(objectName, relationshipIndex, correctTask)
    candidateNamesByClass.get(candidateClass)!.push(objectRecord.name)
  })

  return candidateNamesByClass
}

function simulateCandidate(
  candidateName: string,
  placedObjects: PlacedObject[],
  relationshipIndex: RelationshipIndex,
  activeTask: TaskCandidate,
): CandidateSimulation | null {
  const candidate = relationshipIndex.objectByName.get(candidateName)

  if (!candidate) {
    return null
  }

  const nextPlacedObjects = [...placedObjects, candidate]
  const difficultyBreakdown = calculateBoardDifficulty(nextPlacedObjects, activeTask)

  return {
    candidate,
    difficulty: difficultyBreakdown.total,
    difficultyBreakdown,
  }
}

function chooseBestSimulation(simulations: CandidateSimulation[], difficultyRule: DifficultyTarget) {
  if (!simulations.length) {
    return null
  }

  if (difficultyRule.kind === 'ceiling') {
    const viableSimulations = simulations
      .filter((simulation) => simulation.difficulty < difficultyRule.value)
      .sort((left, right) => right.difficulty - left.difficulty)

    return viableSimulations[0] ?? null
  }

  const aboveFloor = simulations
    .filter((simulation) => simulation.difficulty > difficultyRule.value)
    .sort((left, right) => left.difficulty - right.difficulty)

  if (aboveFloor.length > 0) {
    return aboveFloor[0]
  }

  const belowFloor = simulations.sort((left, right) => right.difficulty - left.difficulty)
  return belowFloor[0] ?? null
}

function hasSatisfiedDifficultyRule(difficulty: number, difficultyRule: DifficultyTarget) {
  return difficultyRule.kind === 'ceiling'
    ? difficulty < difficultyRule.value
    : difficulty > difficultyRule.value
}

function drawCandidatesForStep(
  relationshipIndex: RelationshipIndex,
  activeTask: TaskCandidate,
  selectedNames: Set<string>,
) {
  const candidateNamesByClass = collectCandidateNames(relationshipIndex, activeTask, selectedNames)
  const candidates: string[] = []

  ;(['isolated', 'non-overlap', 'overlap'] as CandidateClass[]).forEach((candidateClass) => {
    const pool = candidateNamesByClass.get(candidateClass) ?? []

    if (!pool.length) {
      return
    }

    candidates.push(randomItem(pool))
  })

  return candidates
}

function buildRoundPlan(
  selection: TaskSelection,
  learningItemsByObjectName: Map<string, LearningItem>,
  languageProgress: LanguageProgress | null,
  relationshipIndex: RelationshipIndex,
): RoundPlan {
  const sourceObject = relationshipIndex.objectByName.get(selection.activeTask.sourceName)
  const targetObject = relationshipIndex.objectByName.get(selection.activeTask.targetName)

  if (!sourceObject || !targetObject) {
    throw new Error('The selected task references an object missing from the object pool.')
  }

  const placedObjects = [sourceObject, targetObject]
  const selectedNames = new Set(placedObjects.map(({ name }) => name))
  const difficultyTarget = resolveDifficultyRule(
    selection.activeTask,
    learningItemsByObjectName,
    languageProgress,
  )
  let difficultyBreakdown = calculateBoardDifficulty(placedObjects, selection.activeTask)

  if (difficultyTarget.kind === 'ceiling' && difficultyBreakdown.total >= difficultyTarget.value) {
    return {
      activeTask: selection.activeTask,
      difficulty: difficultyBreakdown.total,
      difficultyBreakdown,
      difficultyTarget,
      placedObjects,
      reviewPredictedRecall: selection.reviewPredictedRecall,
      selectionMode: selection.selectionMode,
    }
  }

  if (difficultyTarget.kind === 'floor' && difficultyBreakdown.total > difficultyTarget.value) {
    return {
      activeTask: selection.activeTask,
      difficulty: difficultyBreakdown.total,
      difficultyBreakdown,
      difficultyTarget,
      placedObjects,
      reviewPredictedRecall: selection.reviewPredictedRecall,
      selectionMode: selection.selectionMode,
    }
  }

  while (placedObjects.length < BOARD_CAPACITY) {
    const candidateNames = drawCandidatesForStep(relationshipIndex, selection.activeTask, selectedNames)

    if (!candidateNames.length) {
      break
    }

    const simulations = shuffled(candidateNames)
      .map((candidateName) =>
        simulateCandidate(candidateName, placedObjects, relationshipIndex, selection.activeTask),
      )
      .filter((simulation): simulation is CandidateSimulation => simulation !== null)
    const chosenSimulation = chooseBestSimulation(simulations, difficultyTarget)

    if (!chosenSimulation) {
      break
    }

    placedObjects.push(chosenSimulation.candidate)
    selectedNames.add(chosenSimulation.candidate.name)
    difficultyBreakdown = chosenSimulation.difficultyBreakdown

    if (difficultyTarget.kind === 'ceiling') {
      continue
    }

    if (hasSatisfiedDifficultyRule(difficultyBreakdown.total, difficultyTarget)) {
      break
    }
  }

  return {
    activeTask: selection.activeTask,
    difficulty: difficultyBreakdown.total,
    difficultyBreakdown,
    difficultyTarget,
    placedObjects,
    reviewPredictedRecall: selection.reviewPredictedRecall,
    selectionMode: selection.selectionMode,
  }
}

export function planRound({
  languageProgress,
  learningItemsByObjectName,
  relationshipIndex,
  sentenceItemsByKey,
}: PlanRoundOptions): RoundPlan {
  const selection = selectTask(relationshipIndex, sentenceItemsByKey)

  return buildRoundPlan(selection, learningItemsByObjectName, languageProgress, relationshipIndex)
}

export function objectHasRelationships(record: ObjectRecord) {
  return Object.keys(record.relationships ?? {}).length > 0
}
