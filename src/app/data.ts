import type { LanguageOption, LocaleTaskMap, ObjectRecord, PlacedObject } from './types'

async function loadText(url: string, errorMessage: string) {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${errorMessage} (${response.status} ${response.statusText})`)
  }

  return response.text()
}

async function loadJson<T>(url: string, errorMessage: string): Promise<T> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${errorMessage} (${response.status} ${response.statusText})`)
  }

  const contentType = response.headers.get('content-type') ?? ''

  if (!contentType.includes('application/json')) {
    const body = (await response.text()).slice(0, 120)
    throw new Error(
      `${errorMessage} (expected JSON, got ${contentType || 'unknown content type'}): ${body}`,
    )
  }

  return (await response.json()) as T
}

async function loadObjectNames() {
  const text = await loadText('/objects/_index.txt', 'Failed to load object index.')

  return text
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
}

async function loadObjectRecord(name: string) {
  return loadJson<ObjectRecord>(`/objects/${name}.json`, `Failed to load object record: ${name}`)
}

export async function loadLanguageOptions() {
  const catalog = await loadJson<Record<string, string>>(
    '/tpr-board-data/index.json',
    'Failed to load language index.',
  )

  return Object.entries(catalog).map<LanguageOption>(([code, name]) => ({
    code,
    name,
  }))
}

export async function loadLocaleTaskMap(languageCode: string) {
  return loadJson<LocaleTaskMap>(
    `/tpr-board-data/${languageCode}/${languageCode}.json`,
    `Failed to load locale task strings: ${languageCode}.`,
  )
}

export async function loadObjectPool(): Promise<PlacedObject[]> {
  const objectNames = await loadObjectNames()

  return Promise.all(
    objectNames.map(async (name) => ({
      name,
      record: await loadObjectRecord(name),
    })),
  )
}
