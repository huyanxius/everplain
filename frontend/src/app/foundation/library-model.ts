import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { randomSequence } from './world-materials'
import type { WorldMaterials } from './world-materials'

type Part = { matrix: THREE.Matrix4; color?: THREE.Color }

export function createLibrary(materials: WorldMaterials) {
  const root = new THREE.Group()
  root.name = 'open-air-library'
  const random = randomSequence(121)
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1)
  const roundedGeometry = new RoundedBoxGeometry(1, 1, 1, 2, .035)
  const covers: Part[] = [], pages: Part[] = [], bands: Part[] = []
  const palette = ['#666c4f', '#a79471', '#423e2e', '#e0d5b5', '#736447', '#7f4936', '#3d5146', '#aaa58c']
  const shape = (parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], material: THREE.Material, rounded = false) => {
    const mesh = new THREE.Mesh(rounded ? roundedGeometry : boxGeometry, material)
    mesh.position.set(...position); mesh.scale.set(...size)
    mesh.castShadow = true; mesh.receiveShadow = true
    parent.add(mesh)
    return mesh
  }
  const cylinder = (parent: THREE.Object3D, radius: number, height: number, position: [number, number, number], material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32), material)
    mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh)
    return mesh
  }
  const addInstance = (parts: Part[], parent: THREE.Object3D, size: [number, number, number], position: [number, number, number], color?: THREE.Color) => {
    const local = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion(), new THREE.Vector3(...size))
    parent.updateWorldMatrix(true, false)
    parts.push({ matrix: parent.matrixWorld.clone().multiply(local), color })
  }
  const floor = cylinder(root, 9.3, .17, [7, .03, -16], materials.concrete)
  floor.name = 'circular-reading-floor'
  const rim = new THREE.Mesh(new THREE.TorusGeometry(9.2, .025, 8, 96), materials.brass)
  rim.rotation.x = Math.PI / 2; rim.position.set(7, .13, -16); root.add(rim)

  // Each book has separate covers, a spine and a page block. Only repeated
  // geometry is instanced; the camera can look between and behind the shelves.
  for (let bay = 0; bay < 10; bay++) {
    const angle = -.99 + bay * .22
    const shelf = new THREE.Group()
    shelf.position.set(7 + Math.sin(angle) * 8.3, .16, -16 - Math.cos(angle) * 8.3)
    shelf.rotation.y = -angle; shelf.name = `shelf-${bay}`; root.add(shelf)
    shape(shelf, [1.88, 4.75, .075], [0, 2.4, -.34], materials.darkWood)
    shape(shelf, [.09, 4.95, .61], [-.94, 2.49, 0], materials.wood)
    shape(shelf, [.09, 4.95, .61], [.94, 2.49, 0], materials.wood)
    shape(shelf, [2.04, .14, .72], [0, 4.93, .025], materials.wood, true)
    for (let row = 0; row < 6; row++) {
      const y = .12 + row * .8
      shape(shelf, [1.92, .075, .68], [0, y, .025], materials.wood)
      let x = -.84
      while (x < .80) {
        const w = .075 + random() * .095
        const h = .44 + random() * .27
        const d = .30 + random() * .10
        const center = x + w / 2
        const color = new THREE.Color(palette[Math.floor(random() * palette.length)])
        addInstance(pages, shelf, [w - .018, h - .04, d - .025], [center, y + h / 2 + .055, .04], undefined)
        addInstance(covers, shelf, [.012, h, d], [center - w / 2, y + h / 2 + .055, .04], color)
        addInstance(covers, shelf, [.012, h, d], [center + w / 2, y + h / 2 + .055, .04], color)
        addInstance(covers, shelf, [w + .012, h, .018], [center, y + h / 2 + .055, .04 + d / 2], color)
        for (const band of [.16, .79]) addInstance(bands, shelf, [w * .73, .008, .004], [center, y + .055 + h * band, .054 + d / 2])
        x += w + .015 + random() * .016
      }
    }
    if (bay % 3 === 0) {
      shape(shelf, [.16, 5.5, .48], [-1.06, 2.75, -.08], materials.concrete)
      shape(shelf, [.032, 5.35, .52], [-1.06, 2.78, -.08], materials.brass)
    }
  }
  const instantiate = (parts: Part[], material: THREE.Material, name: string) => {
    const mesh = new THREE.InstancedMesh(boxGeometry, material, parts.length)
    mesh.name = name
    parts.forEach((part, i) => { mesh.setMatrixAt(i, part.matrix); if (part.color) mesh.setColorAt(i, part.color) })
    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh)
  }
  instantiate(covers, materials.linen, 'book-covers-and-spines')
  instantiate(pages, materials.paper, 'book-pages')
  instantiate(bands, materials.brass, 'book-spine-bands')

  const cabinet = new THREE.Group()
  cabinet.name = 'card-catalog'; cabinet.position.set(2, .15, -13); cabinet.rotation.y = -.18; root.add(cabinet)
  shape(cabinet, [2.5, 2.8, .78], [0, 1.45, -.10], materials.darkWood, true)
  shape(cabinet, [2.65, .11, .94], [0, 2.9, -.05], materials.wood, true)
  const drawer = new THREE.Group()
  drawer.name = 'open-catalog-drawer'
  for (let row = 0; row < 6; row++) for (let col = 0; col < 5; col++) {
    const parent = row === 3 && col === 1 ? drawer : cabinet
    const x = (col - 2) * .475, y = .36 + row * .43
    if (parent === drawer) cabinet.add(drawer)
    shape(parent, [.45, .39, .1], [x, y, .35], materials.wood, true)
    shape(parent, [.25, .105, .015], [x, y + .07, .409], materials.brass, true)
    shape(parent, [.204, .061, .018], [x, y + .071, .42], materials.paper)
    shape(parent, [.11, .018, .04], [x, y - .07, .455], materials.brass, true)
    for (const dx of [-.065, .065]) shape(parent, [.015, .055, .055], [x + dx, y - .057, .435], materials.brass)
  }
  shape(drawer, [.44, .025, .56], [-.475, 1.48, .05], materials.darkWood)
  for (const dx of [-.215, .215]) shape(drawer, [.018, .23, .56], [-.475 + dx, 1.61, .05], materials.wood)
  for (let i = 0; i < 19; i++) shape(drawer, [.38, .27 + random() * .015, .008], [-.475, 1.66, -.15 + i * .02], materials.paper)
  drawer.position.z = .16

  const desk = new THREE.Group()
  desk.name = 'reading-table'; desk.position.set(6, .14, -9.1); desk.rotation.y = -.28; root.add(desk)
  shape(desk, [3.4, .12, 1.28], [0, 1.05, 0], materials.wood, true)
  for (const x of [-1.45, 1.45]) for (const z of [-.48, .48]) shape(desk, [.055, 1, .055], [x, .5, z], materials.brass)
  shape(desk, [2.94, .12, .045], [0, .35, -.48], materials.brass)

  const machine = new THREE.Group()
  machine.name = 'reel-to-reel-machine'; machine.position.set(.60, 1.17, -.02); machine.rotation.x = -.12; desk.add(machine)
  shape(machine, [1.35, .72, .34], [0, .36, 0], materials.silver, true)
  shape(machine, [1.38, .76, .13], [0, .36, -.18], materials.darkWood, true)
  shape(machine, [1.20, .24, .025], [0, .16, .183], materials.black, true)
  const reels: THREE.Group[] = []
  const reelShape = new THREE.Shape()
  reelShape.absarc(0, 0, .265, 0, Math.PI * 2, false)
  for (let i = 0; i < 5; i++) {
    const angle = i / 5 * Math.PI * 2
    const hole = new THREE.Path()
    hole.absarc(Math.sin(angle) * .159, Math.cos(angle) * .159, .066, 0, Math.PI * 2, true)
    reelShape.holes.push(hole)
  }
  const reelGeometry = new THREE.ExtrudeGeometry(reelShape, { depth: .012, bevelEnabled: true, bevelSize: .002, bevelThickness: .002, bevelSegments: 1, steps: 1, curveSegments: 16 })
  for (const x of [-.37, .37]) {
    const reel = new THREE.Group(); reel.position.set(x, .63, .24); machine.add(reel); reels.push(reel)
    const tape = cylinder(reel, .214, .035, [0, 0, -.025], materials.black); tape.rotation.x = Math.PI / 2
    const plate = new THREE.Mesh(reelGeometry, materials.silver); plate.castShadow = true; reel.add(plate)
    const hub = cylinder(reel, .046, .065, [0, 0, .025], materials.brass); hub.rotation.x = Math.PI / 2
  }
  for (const x of [-.43, -.14, .15, .44]) {
    const knob = cylinder(machine, .046, .04, [x, .11, .22], materials.silver); knob.rotation.x = Math.PI / 2
    shape(machine, [.008, .025, .008], [x, .121, .245], materials.black)
  }
  for (const x of [-.18, .18]) {
    shape(machine, [.24, .09, .015], [x, .25, .209], materials.paper)
    for (let i = 0; i < 7; i++) shape(machine, [.005, .016, .002], [x - .09 + i * .03, .267, .22], materials.black)
    const needle = shape(machine, [.003, .05, .003], [x + .02, .24, .223], materials.black); needle.rotation.z = -.35
  }
  shape(machine, [.018, .018, .012], [.57, .27, .21], materials.glow)
  const tapeLine = new THREE.CatmullRomCurve3([new THREE.Vector3(-.37,.42,.20),new THREE.Vector3(-.20,.34,.20),new THREE.Vector3(.20,.34,.20),new THREE.Vector3(.37,.42,.20)])
  machine.add(new THREE.Mesh(new THREE.TubeGeometry(tapeLine, 20, .006, 4, false), materials.black))

  const openBook = new THREE.Group(); openBook.name = 'open-book'; openBook.position.set(-.87, 1.13, .19); openBook.rotation.y = -.25; desk.add(openBook)
  for (const side of [-1, 1]) {
    const leaf = new THREE.Group(); leaf.rotation.z = side * -.085; leaf.position.x = side * .235; openBook.add(leaf)
    shape(leaf, [.46, .026, .62], [0, .005, 0], materials.darkWood)
    shape(leaf, [.435, .038, .585], [0, .037, 0], materials.paper)
    for (let line = 0; line < 15; line++) shape(leaf, [.30 - (line % 4 === 0 ? .045 : 0), .0008, .0018], [0, .057, -.22 + line * .031], materials.darkWood)
  }
  function lamp(parent: THREE.Object3D, x: number, y: number, z: number) {
    const group = new THREE.Group(); group.position.set(x, y, z); parent.add(group)
    cylinder(group, .14, .035, [0, .018, 0], materials.brass)
    cylinder(group, .015, .55, [0, .29, 0], materials.brass)
    const shade = new THREE.Mesh(new THREE.SphereGeometry(.22, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), materials.brass)
    shade.position.y = .60; shade.scale.y = .6; group.add(shade)
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(.065, 12, 8), materials.glow); bulb.position.y = .575; group.add(bulb)
    const light = new THREE.PointLight('#ffcb82', 9, 3.5, 2); light.position.set(0, .52, .04); group.add(light)
  }
  lamp(desk, -1.35, 1.12, -.30)
  for (const x of [1.9, 7, 12.1]) {
    const glow = new THREE.PointLight('#f7c88b', 22, 7, 2); glow.position.set(x, 3.3, -21); root.add(glow)
    const bar = shape(root, [.035, .8, .035], [x, 3.5, -21.3], materials.glow)
    bar.castShadow = false
  }
  return { root, reels, drawer, bookCount: pages.length }
}
