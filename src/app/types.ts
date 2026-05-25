export type RelationshipEffect =
  | 'NOTHING'
  | 'RETURN'
  | 'DISAPPEAR'
  | 'DESTRUCT'
  | 'WIGGLE'
  | 'HELD'

export type EbisuModel = [number, number, number]

export type RoundOutcome = 'correct' | 'wrong'

export type HoldPlacement = {
  anchor: [number, number, number]
  scale: number
}

export type RelationshipDefinition = [string, RelationshipEffect, RelationshipEffect]

export type ObjectRecord = {
  model: string
  hold?: HoldPlacement
  relationships?: Record<string, RelationshipDefinition>
}

export type LocaleTaskMap = Record<string, string[]>

export type LanguageOption = {
  code: string
  name: string
}

export type PlacedObject = {
  name: string
  record: ObjectRecord
}

export type TaskCandidate = {
  key: string
  text: string
  textIndex: number
  sourceName: string
  targetName: string
  sourceEffect: RelationshipEffect
  targetEffect: RelationshipEffect
}

export type PlayableRelationship = {
  formulations: string[]
  key: string
  sourceEffect: RelationshipEffect
  sourceName: string
  targetEffect: RelationshipEffect
  targetName: string
}

export type RelationshipIndex = {
  inboundSourcesByTarget: Map<string, Set<string>>
  isolatedNames: string[]
  objectByName: Map<string, PlacedObject>
  outboundTargetsBySource: Map<string, Set<string>>
  playableEdgesBySource: Map<string, PlayableRelationship[]>
  playableSourceNames: string[]
}

export type DifficultyBreakdown = {
  missingRelationshipCount: number
  missingRelationshipDifficulty: number
  overlappingRelationshipCount: number
  overlappingRelationshipDifficulty: number
  total: number
  unrelatedRelationshipCount: number
  unrelatedRelationshipDifficulty: number
}

export type DifficultyTarget = {
  kind: 'ceiling' | 'floor'
  reason: string
  value: number
}

export type RoundPlan = {
  activeTask: TaskCandidate
  difficulty: number
  difficultyBreakdown: DifficultyBreakdown
  difficultyTarget: DifficultyTarget
  placedObjects: PlacedObject[]
}

export type LearningItem = {
  correctCount: number
  ebisuModel: EbisuModel
  incorrectCount: number
  key: string
  languageCode: string
  lastReviewedAt: number
  objectName: string
  seenCount: number
}

export type LearningEvent = {
  attemptCount: number
  boardObjectNames: string[]
  completedAt: number
  difficulty: number
  hadWrongAttempt: boolean
  id?: number
  languageCode: string
  sourceName: string
  targetName: string
  taskKey: string
}

export type LanguageProgress = {
  languageCode: string
  lastBoardDifficulty: number
  lastOutcome: RoundOutcome
}
