export type ObjectRecord = {
  model: string
  relationships?: Record<string, string[]>
}

export type LocaleTaskMap = Record<string, string[]>

export type PlacedObject = {
  name: string
  record: ObjectRecord
}
