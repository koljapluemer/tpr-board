import type { LocaleTaskMap, ObjectRecord, PlacedObject, TaskCandidate } from './types'
import { shuffled } from './utils'

function objectHasRelationships(record: ObjectRecord) {
  return Object.keys(record.relationships ?? {}).length > 0
}

export function findTaskCandidates(placedObjects: PlacedObject[], localeTaskMap: LocaleTaskMap) {
  const availableTasks: TaskCandidate[] = []
  const placedObjectNames = new Set(placedObjects.map((placedObject) => placedObject.name))

  placedObjects.forEach(({ name, record }) => {
    Object.entries(record.relationships ?? {}).forEach(([targetName, relationship]) => {
      if (!placedObjectNames.has(targetName)) {
        return
      }

      const [verb, sourceEffect, targetEffect] = relationship
      const taskKey = `${name}_${verb}_${targetName}`
      const formulations = localeTaskMap[taskKey]

      formulations?.forEach((text, textIndex) => {
        availableTasks.push({
          key: taskKey,
          text,
          textIndex,
          sourceEffect,
          sourceName: name,
          targetEffect,
          targetName,
        })
      })
    })
  })

  return availableTasks
}

function findRelatedObjectPool(
  placedObjects: PlacedObject[],
  objectPoolByName: Map<string, ObjectRecord>,
) {
  const placedObjectNames = new Set(placedObjects.map(({ name }) => name))
  const relatedObjectNames = new Set<string>()

  placedObjects.forEach(({ record }) => {
    Object.keys(record.relationships ?? {}).forEach((targetName) => {
      if (!placedObjectNames.has(targetName) && objectPoolByName.has(targetName)) {
        relatedObjectNames.add(targetName)
      }
    })
  })

  return shuffled([...relatedObjectNames]).map((name) => ({
    name,
    record: objectPoolByName.get(name)!,
  }))
}

export function selectBoardObjects(objectPool: PlacedObject[], localeTaskMap: LocaleTaskMap) {
  const selectableObjects = shuffled(objectPool.filter(({ record }) => objectHasRelationships(record)))

  if (!selectableObjects.length) {
    throw new Error('No objects with relationships were found.')
  }

  const selectedObjects = selectableObjects.slice(0, 4)

  if (findTaskCandidates(selectedObjects, localeTaskMap).length > 0) {
    return selectedObjects
  }

  const objectPoolByName = new Map(objectPool.map(({ name, record }) => [name, record]))
  const relatedCandidates = findRelatedObjectPool(selectedObjects, objectPoolByName)

  if (!relatedCandidates.length) {
    return selectedObjects
  }

  const candidateThatUnlocksTask =
    relatedCandidates.find((candidate) => {
      return findTaskCandidates([...selectedObjects, candidate], localeTaskMap).length > 0
    }) ?? relatedCandidates[0]

  return [...selectedObjects, candidateThatUnlocksTask]
}
