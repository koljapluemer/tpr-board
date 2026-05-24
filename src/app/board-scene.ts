import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'

import type { PlacedObject } from './types'
import { shuffled } from './utils'

type SceneObject = PlacedObject & {
  wrapper: THREE.Group
  homePosition: THREE.Vector3
  radius: number
  yawVelocity: number
  wigglePhase: number
  wiggleStrength: number
}

type DragState = {
  object: SceneObject
  pointerId: number
  grabOffset: THREE.Vector3
}

const CAMERA_POSITION = new THREE.Vector3(0, 18, 15)
const CAMERA_ROTATION = new THREE.Euler(-0.98, 0, 0, 'XYZ')
const BOARD_CELLS = [
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
const HOVER_YAW_SPEED = Math.PI / 3
const HOVER_ACCELERATION = 10
const DRAG_LIFT = 0.9
const WIGGLE_SPEED = 26
const WIGGLE_DAMPING = 14
const WIGGLE_ANGLE = 0.14
const SPAWN_YAW_VARIATION = Math.PI / 6

export class BoardScene {
  private readonly boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
  private readonly camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  private readonly fillLight = new THREE.DirectionalLight(0xffffff, 1.2)
  private readonly grabPoint = new THREE.Vector3()
  private readonly hoverableObjects: SceneObject[] = []
  private readonly keyLight = new THREE.DirectionalLight(0xffffff, 2.4)
  private readonly planeIntersection = new THREE.Vector3()
  private readonly pointer = new THREE.Vector2(2, 2)
  private readonly raycaster = new THREE.Raycaster()
  private readonly renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true })
  private readonly scene = new THREE.Scene()
  private readonly sceneRoot: HTMLDivElement
  private readonly spawnLookTarget = new THREE.Vector3()

  private boardCreated = false
  private dragState: DragState | null = null
  private hoveredObject: SceneObject | null = null
  private lastFrameTime = performance.now()

  constructor(sceneRoot: HTMLDivElement) {
    this.sceneRoot = sceneRoot

    this.camera.position.copy(CAMERA_POSITION)
    this.camera.rotation.copy(CAMERA_ROTATION)

    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.setSize(1, 1, false)
    this.sceneRoot.appendChild(this.renderer.domElement)

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.8))

    this.keyLight.position.set(6, 12, 8)
    this.scene.add(this.keyLight)

    this.fillLight.position.set(-5, 8, -6)
    this.scene.add(this.fillLight)

    window.addEventListener('resize', this.resizeRenderer)
    this.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown)
    this.renderer.domElement.addEventListener('pointermove', this.handlePointerMove)
    this.renderer.domElement.addEventListener('pointerup', this.handlePointerUp)
    this.renderer.domElement.addEventListener('pointercancel', this.handlePointerCancel)
    this.renderer.domElement.addEventListener('pointerleave', this.clearHoveredObject)

    window.requestAnimationFrame(this.animate)
  }

  async initialize(placedObjects: PlacedObject[]) {
    if (!this.boardCreated) {
      this.createBoard()
      this.boardCreated = true
    }

    await this.placeObjects(placedObjects)
    this.resizeRenderer()
  }

  private readonly animate = (now: number) => {
    const deltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.05)
    this.lastFrameTime = now

    this.hoverableObjects.forEach((sceneObject) => {
      const targetVelocity =
        !this.dragState && sceneObject === this.hoveredObject ? HOVER_YAW_SPEED : 0

      sceneObject.yawVelocity = THREE.MathUtils.damp(
        sceneObject.yawVelocity,
        targetVelocity,
        HOVER_ACCELERATION,
        deltaSeconds,
      )
      sceneObject.wrapper.rotation.y += sceneObject.yawVelocity * deltaSeconds
      sceneObject.wiggleStrength = THREE.MathUtils.damp(
        sceneObject.wiggleStrength,
        0,
        WIGGLE_DAMPING,
        deltaSeconds,
      )
      sceneObject.wigglePhase += deltaSeconds * WIGGLE_SPEED
      sceneObject.wrapper.rotation.z =
        Math.sin(sceneObject.wigglePhase) * sceneObject.wiggleStrength * WIGGLE_ANGLE
    })

    this.renderer.render(this.scene, this.camera)
    window.requestAnimationFrame(this.animate)
  }

  private readonly clearHoveredObject = () => {
    if (this.dragState) {
      return
    }

    this.pointer.set(2, 2)
    this.hoveredObject = null
  }

  private createBoard() {
    const squareGeometry = new THREE.PlaneGeometry(3.6, 3.6)
    const lightSquare = new THREE.MeshStandardMaterial({ color: 0xe7e0d3, roughness: 1 })
    const darkSquare = new THREE.MeshStandardMaterial({ color: 0xd8cfbf, roughness: 1 })

    BOARD_CELLS.forEach((cell, index) => {
      const row = Math.floor(index / 3)
      const column = index % 3
      const square = new THREE.Mesh(
        squareGeometry,
        (row + column) % 2 === 0 ? lightSquare : darkSquare,
      )

      square.rotation.x = -Math.PI / 2
      square.position.set(cell.x, -0.02, cell.z)
      this.scene.add(square)
    })
  }

  private findSceneObject(target: THREE.Object3D | null) {
    let current: THREE.Object3D | null = target

    while (current) {
      const sceneObject = current.userData.sceneObject as SceneObject | undefined

      if (sceneObject) {
        return sceneObject
      }

      current = current.parent
    }

    return null
  }

  private readonly handlePointerCancel = (event: PointerEvent) => {
    this.stopDrag(event.pointerId)
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.startDrag(event)
  }

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.setPointerFromEvent(event)) {
      return
    }

    if (this.dragState?.pointerId === event.pointerId) {
      this.updateDraggedObjectPosition()
      return
    }

    this.updateHoveredObject()
  }

  private readonly handlePointerUp = (event: PointerEvent) => {
    this.stopDrag(event.pointerId)
  }

  private normalizeModel(model: THREE.Group) {
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

    const scaledSize = scaledBox.getSize(new THREE.Vector3())

    return {
      radius: Math.max(scaledSize.x, scaledSize.z) * 0.45,
    }
  }

  private orientSpawnedObjectTowardCamera(wrapper: THREE.Object3D) {
    this.spawnLookTarget.set(this.camera.position.x, wrapper.position.y, this.camera.position.z)
    wrapper.lookAt(this.spawnLookTarget)
    wrapper.rotateY(THREE.MathUtils.randFloatSpread(SPAWN_YAW_VARIATION * 2))
  }

  private async loadModel(modelPath: string): Promise<GLTF> {
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

  private async placeObjects(placedObjects: PlacedObject[]) {
    const occupiedCells = shuffled(BOARD_CELLS).slice(0, placedObjects.length)

    await Promise.all(
      placedObjects.map(async ({ name: objectName, record }, index) => {
        const cell = occupiedCells[index]

        if (!cell) {
          throw new Error('Not enough grid cells available for the selected objects.')
        }

        const gltf = await this.loadModel(record.model)
        const wrapper = new THREE.Group()

        const { radius } = this.normalizeModel(gltf.scene)
        wrapper.add(gltf.scene)
        wrapper.position.copy(cell)
        this.orientSpawnedObjectTowardCamera(wrapper)

        const sceneObject = {
          name: objectName,
          record,
          wrapper,
          homePosition: cell.clone(),
          radius,
          yawVelocity: 0,
          wigglePhase: Math.random() * Math.PI * 2,
          wiggleStrength: 0,
        } satisfies SceneObject

        wrapper.userData.sceneObject = sceneObject
        this.hoverableObjects.push(sceneObject)
        this.scene.add(wrapper)
      }),
    )
  }

  private projectPointerToBoard() {
    this.raycaster.setFromCamera(this.pointer, this.camera)
    return this.raycaster.ray.intersectPlane(this.boardPlane, this.planeIntersection)
  }

  private readonly resizeRenderer = () => {
    const { clientWidth, clientHeight } = this.sceneRoot

    if (!clientWidth || !clientHeight) {
      return
    }

    this.camera.aspect = clientWidth / clientHeight
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(clientWidth, clientHeight, true)
    this.renderer.render(this.scene, this.camera)
  }

  private setPointerFromEvent(event: PointerEvent) {
    const bounds = this.renderer.domElement.getBoundingClientRect()

    if (!bounds.width || !bounds.height) {
      return false
    }

    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1

    return true
  }

  private startDrag(event: PointerEvent) {
    if (this.dragState) {
      return
    }

    if (!this.setPointerFromEvent(event)) {
      return
    }

    this.updateHoveredObject()

    if (!this.hoveredObject) {
      return
    }

    const point = this.projectPointerToBoard()

    if (!point) {
      return
    }

    const object = this.hoveredObject
    this.dragState = {
      object,
      pointerId: event.pointerId,
      grabOffset: this.grabPoint.copy(object.wrapper.position).sub(point).clone(),
    }
    object.wrapper.position.y = DRAG_LIFT
    this.hoveredObject = null
    this.renderer.domElement.setPointerCapture(event.pointerId)
    this.updateDraggedObjectPosition()
  }

  private stopDrag(pointerId: number) {
    if (!this.dragState || this.dragState.pointerId !== pointerId) {
      return
    }

    if (this.renderer.domElement.hasPointerCapture(pointerId)) {
      this.renderer.domElement.releasePointerCapture(pointerId)
    }

    this.dragState.object.wrapper.position.copy(this.dragState.object.homePosition)
    this.dragState = null
    this.updateHoveredObject()
  }

  private updateDragTargets() {
    const draggedObject = this.dragState?.object

    if (!draggedObject) {
      return
    }

    this.hoverableObjects.forEach((sceneObject) => {
      if (sceneObject === draggedObject) {
        return
      }

      const dx = draggedObject.wrapper.position.x - sceneObject.wrapper.position.x
      const dz = draggedObject.wrapper.position.z - sceneObject.wrapper.position.z
      const collisionDistance = draggedObject.radius + sceneObject.radius

      if (dx * dx + dz * dz <= collisionDistance * collisionDistance) {
        sceneObject.wiggleStrength = 1
      }
    })
  }

  private updateDraggedObjectPosition() {
    if (!this.dragState) {
      return
    }

    const point = this.projectPointerToBoard()

    if (!point) {
      return
    }

    this.dragState.object.wrapper.position.copy(point).add(this.dragState.grabOffset)
    this.dragState.object.wrapper.position.y = DRAG_LIFT
    this.updateDragTargets()
  }

  private updateHoveredObject() {
    if (this.dragState) {
      this.hoveredObject = null
      return
    }

    this.raycaster.setFromCamera(this.pointer, this.camera)

    const intersections = this.raycaster.intersectObjects(
      this.hoverableObjects.map(({ wrapper }) => wrapper),
      true,
    )

    this.hoveredObject = this.findSceneObject(intersections[0]?.object ?? null)
  }
}
