import './style.css'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

type ObjectRecord = {
  model: string
  relationships?: Record<string, string[]>
}

type LocaleTaskMap = Record<string, string[]>

type PlacedObject = {
  name: string
  record: ObjectRecord
}

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('App root not found.')
}

app.innerHTML = `
  <div id="layout">
    <section id="task-panel">
      <h1 id="task-text"></h1>
    </section>
    <div id="scene"></div>
  </div>
`

const sceneRoot = document.querySelector<HTMLDivElement>('#scene')!
const taskText = document.querySelector<HTMLHeadingElement>('#task-text')!

const scene = new THREE.Scene()

const CAMERA_POSITION = new THREE.Vector3(3, 18, 15)
const CAMERA_ROTATION = new THREE.Euler(-0.98, 0, 0, 'XYZ')

const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
camera.position.copy(CAMERA_POSITION)
camera.rotation.copy(CAMERA_ROTATION)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.setClearColor(0xf1eee7, 1)
sceneRoot.appendChild(renderer.domElement)

scene.add(new THREE.AmbientLight(0xffffff, 1.8))

const keyLight = new THREE.DirectionalLight(0xffffff, 2.4)
keyLight.position.set(6, 12, 8)
scene.add(keyLight)

const fillLight = new THREE.DirectionalLight(0xffffff, 1.2)
fillLight.position.set(-5, 8, -6)
scene.add(fillLight)

const gridCells = [
  new THREE.Vector3(-4, 0, -4),
  new THREE.Vector3(0, 0, -4),
  new THREE.Vector3(4, 0, -4),
  new THREE.Vector3(-4, 0, 0),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(4, 0, 0),
  new THREE.Vector3(-4, 0, 4),
  new THREE.Vector3(0, 0, 4),
  new THREE.Vector3(4, 0, 4),
]

function randomItem<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]

  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1))
    ;[copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]]
  }

  return copy
}

function resizeRenderer() {
  const { clientWidth, clientHeight } = sceneRoot

  if (!clientWidth || !clientHeight) {
    return
  }

  camera.aspect = clientWidth / clientHeight
  camera.updateProjectionMatrix()
  renderer.setSize(clientWidth, clientHeight, true)
  renderer.render(scene, camera)
}

function createBoard() {
  const squareGeometry = new THREE.PlaneGeometry(3.6, 3.6)
  const lightSquare = new THREE.MeshStandardMaterial({ color: 0xe7e0d3, roughness: 1 })
  const darkSquare = new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 1 })

  gridCells.forEach((cell, index) => {
    const row = Math.floor(index / 3)
    const column = index % 3
    const square = new THREE.Mesh(
      squareGeometry,
      (row + column) % 2 === 0 ? lightSquare : darkSquare,
    )

    square.rotation.x = -Math.PI / 2
    square.position.set(cell.x, -0.02, cell.z)
    scene.add(square)
  })
}

function normalizeModel(model: THREE.Group) {
  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  const maxDimension = Math.max(size.x, size.y, size.z) || 1
  const scale = 2.2 / maxDimension

  model.scale.setScalar(scale)

  const scaledBox = new THREE.Box3().setFromObject(model)
  const center = scaledBox.getCenter(new THREE.Vector3())

  model.position.x -= center.x
  model.position.y -= scaledBox.min.y
  model.position.z -= center.z
}

async function loadObjectNames() {
  const response = await fetch('/objects/_index.txt')
  const text = await response.text()

  return text
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean)
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

async function loadObjectRecord(name: string) {
  return loadJson<ObjectRecord>(`/objects/${name}.json`, `Failed to load object record: ${name}`)
}

async function loadLocaleTaskMap() {
  return loadJson<LocaleTaskMap>('/tpr-board-data/deu/deu.json', 'Failed to load German task strings.')
}

async function loadModel(modelPath: string): Promise<GLTF> {
  const manager = new THREE.LoadingManager()
  const modelFolder = modelPath.slice(0, modelPath.lastIndexOf('/'))

  manager.setURLModifier((url) => {
    if (url.endsWith('Textures/colormap.png')) {
      return `/models/${modelFolder}/colormap.png`
    }

    return url
  })

  const loader = new GLTFLoader(manager)

  return loader.loadAsync(`/models/${modelPath}`)
}

async function placeObjects() {
  const objectNames = await loadObjectNames()
  const occupiedCells = shuffled(gridCells).slice(0, 4)
  const placedObjects = await Promise.all(
    occupiedCells.map(async (cell) => {
      const objectName = randomItem(objectNames)
      const record = await loadObjectRecord(objectName)
      const gltf = await loadModel(record.model)
      const wrapper = new THREE.Group()

      normalizeModel(gltf.scene)
      wrapper.add(gltf.scene)
      wrapper.position.copy(cell)
      wrapper.rotation.y = Math.random() * Math.PI * 2

      scene.add(wrapper)
      return {
        name: objectName,
        record,
      } satisfies PlacedObject
    }),
  )

  return placedObjects
}

function findPossibleTasks(placedObjects: PlacedObject[], localeTaskMap: LocaleTaskMap) {
  const availableTasks: string[] = []
  const placedObjectNames = new Set(placedObjects.map((placedObject) => placedObject.name))

  placedObjects.forEach(({ name, record }) => {
    Object.entries(record.relationships ?? {}).forEach(([targetName, actions]) => {
      if (!placedObjectNames.has(targetName)) {
        return
      }

      actions.forEach((action) => {
        const taskKey = `${name}_${action}_${targetName}`
        const formulations = localeTaskMap[taskKey]

        if (formulations?.length) {
          availableTasks.push(...formulations)
        }
      })
    })
  })

  return availableTasks
}

function showTask(task: string) {
  taskText.textContent = task
}

async function init() {
  createBoard()
  const [placedObjects, localeTaskMap] = await Promise.all([placeObjects(), loadLocaleTaskMap()])
  const availableTasks = findPossibleTasks(placedObjects, localeTaskMap)

  showTask(
    availableTasks.length
      ? randomItem(availableTasks)
      : '',
  )

  resizeRenderer()
}

window.addEventListener('resize', resizeRenderer)

init().catch((error) => {
  console.error(error)
})
