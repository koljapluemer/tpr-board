export type RelationshipEffect =
  | 'NOTHING'
  | 'RETURN'
  | 'DISAPPEAR'
  | 'DESTRUCT'
  | 'WIGGLE'
  | 'HELD'

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
