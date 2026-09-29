import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { createLibrary } from './library-model'
import { createWorldMaterials, randomSequence, terrainHeight } from './world-materials'

export type MeadowRenderer = {
  setProgress: (value: number) => void
  setPointer: (x: number, y: number) => void
  setMotion: (enabled: boolean) => void
  dispose: () => void
}

export function createMeadowRenderer(host: HTMLDivElement): MeadowRenderer {
  const compact = window.matchMedia('(max-width: 760px)').matches
  const renderer = new THREE.WebGLRenderer({ alpha: false, antialias: true, powerPreference: 'high-performance' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1 : 1.25))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = .94
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.shadowMap.autoUpdate = false
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  host.append(canvas)

  const scene = new THREE.Scene()
  scene.name = 'everplain-spatial-world'
  scene.background = new THREE.Color('#d5d8cc')
  scene.fog = new THREE.FogExp2('#d5d8cc', .017)
  const camera = new THREE.PerspectiveCamera(48, 1, .08, 200)
  const materials = createWorldMaterials()
  const environment = new RoomEnvironment()
  const pmrem = new THREE.PMREMGenerator(renderer)
  const environmentTarget = pmrem.fromScene(environment, .04)
  scene.environment = environmentTarget.texture
  scene.environmentIntensity = .45
  environment.dispose(); pmrem.dispose()
  scene.add(new THREE.HemisphereLight('#f0f3e5', '#8c9373', 1.85))
  const sun = new THREE.DirectionalLight('#fff0ce', 3.1)
  sun.position.set(-15, 22, 7)
  sun.target.position.set(5, 0, -16)
  sun.castShadow = true
  sun.shadow.mapSize.set(compact ? 1024 : 2048, compact ? 1024 : 2048)
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 70 })
  sun.shadow.bias = -.0003
  sun.shadow.normalBias = .025
  scene.add(sun, sun.target)

  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vPosition; void main(){ vPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: `varying vec3 vPosition;
      float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+1.),f.x),f.y); }
      void main(){
        vec3 d=normalize(vPosition); float h=max(d.y,0.);
        vec3 color=mix(vec3(.77,.79,.71),vec3(.40,.53,.51),pow(h,.45));
        float cloud=noise(d.xz/(h+.18)*2.5)*.65+noise(d.xz/(h+.18)*6.)*.35;
        color=mix(color,vec3(.86,.85,.77),smoothstep(.45,.80,cloud)*.32);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const sky = new THREE.Mesh(new THREE.SphereGeometry(145, 32, 16), skyMaterial)
  sky.name = 'procedural-sky'; scene.add(sky)
  const groundGeometry = new THREE.PlaneGeometry(230, 230, 160, 160)
  groundGeometry.rotateX(-Math.PI / 2)
  const groundPositions = groundGeometry.attributes.position
  for (let i = 0; i < groundPositions.count; i++) groundPositions.setY(i, terrainHeight(groundPositions.getX(i), groundPositions.getZ(i)))
  groundGeometry.computeVertexNormals()
  const ground = new THREE.Mesh(groundGeometry, materials.soil)
  ground.name = 'sculpted-meadow-terrain'; ground.receiveShadow = true; scene.add(ground)
  const library = createLibrary(materials)
  scene.add(library.root)

  const random = randomSequence(207)
  const stoneGeometry = new THREE.CylinderGeometry(1, 1.04, .08, 7)
  const stones = new THREE.InstancedMesh(stoneGeometry, materials.concrete, 18)
  stones.name = 'stepping-stones'
  const dummy = new THREE.Object3D()
  for (let i = 0; i < 18; i++) {
    const z = 15 - i * 1.30, x = -.478 * z - .3 + Math.sin(i) * .13
    dummy.position.set(x, terrainHeight(x, z) + .06, z)
    dummy.rotation.set(0, random() * 6, 0); dummy.scale.set(.46 + random() * .12, 1, .39 + random() * .06)
    dummy.updateMatrix(); stones.setMatrixAt(i, dummy.matrix)
  }
  stones.castShadow = true; stones.receiveShadow = true; scene.add(stones)

  const grassGeometry = new THREE.InstancedBufferGeometry()
  const positions: number[] = [], uvs: number[] = [], indices: number[] = []
  for (let i = 0; i <= 4; i++) {
    const h = i / 4
    positions.push(-(1-h)*.5,h,0,(1-h)*.5,h,0); uvs.push(0,h,1,h)
    if (i < 4) { const n=i*2; indices.push(n,n+1,n+2,n+1,n+3,n+2) }
  }
  grassGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  grassGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  grassGeometry.setIndex(indices)
  const count = compact ? 20000 : 65000
  const offsets = new Float32Array(count * 3), shapes = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    let x: number, z: number
    do {
      const near = i < count * .74
      x = (random() - .5) * (near ? 55 : 145) - 8
      z = random() * (near ? 57 : 130) - (near ? 31 : 100)
    } while (Math.hypot(x - 7, z + 16) < 9.5 || (z > -8 && z < 17 && Math.abs(x + .478*z + .3) < .64))
    offsets.set([x, terrainHeight(x, z), z], i * 3)
    shapes.set([.026 + random() * .043, .28 + random() * .68, random() * Math.PI * 2, random()], i * 4)
  }
  grassGeometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
  grassGeometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 4))
  grassGeometry.instanceCount = count
  const wind = { value: 0 }
  const pointer = new THREE.Vector2(), pointerTarget = new THREE.Vector2()
  const grassMaterial = new THREE.ShaderMaterial({
    uniforms: { uTime: wind, uPointer: { value: pointer }, uFog: { value: new THREE.Color('#d5d8cc') } },
    side: THREE.DoubleSide,
    vertexShader: `attribute vec3 aOffset; attribute vec4 aShape;
      uniform float uTime; uniform vec2 uPointer;
      varying float vHeight,vDepth,vLight,vVariation;
      void main(){
        float h=uv.y; float gust=sin(aOffset.x*.19+aOffset.z*.24-uTime*.75);
        float flutter=sin(aOffset.x*.8-aOffset.z*.43+uTime*1.9)*.12;
        vec3 p=vec3(position.x*aShape.x,h*aShape.y,0.);
        p.xz=mat2(cos(aShape.z),-sin(aShape.z),sin(aShape.z),cos(aShape.z))*p.xz;
        p.x+=h*h*(.10+gust*.23+flutter+uPointer.x*.07);
        p.z+=h*h*(.06+gust*.11); p+=aOffset;
        vec4 mv=modelViewMatrix*vec4(p,1.);
        vHeight=h; vDepth=-mv.z; vLight=.75+.25*sin(aShape.z); vVariation=aShape.w;
        gl_Position=projectionMatrix*mv;
      }`,
    fragmentShader: `uniform vec3 uFog; varying float vHeight,vDepth,vLight,vVariation;
      void main(){
        vec3 root=vec3(.047,.065,.022),tip=mix(vec3(.20,.29,.085),vec3(.34,.36,.15),vVariation*.65);
        vec3 color=mix(root,tip,pow(vHeight,.8))*vLight;
        float fog=1.-exp(-.000289*vDepth*vDepth);
        color=mix(color,uFog,fog);
        gl_FragColor=vec4(color,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
  const grass = new THREE.Mesh(grassGeometry, grassMaterial)
  grass.name = 'wind-driven-grass'; grass.frustumCulled = false; scene.add(grass)

  const flowerCount = compact ? 90 : 240
  const petals = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 4), materials.linen, flowerCount * 6)
  const centers = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 4), materials.brass, flowerCount)
  const stems = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 4), materials.soil, flowerCount)
  petals.name = 'wildflower-petals'; centers.name = 'wildflower-centers'; stems.name = 'wildflower-stems'
  for (let i = 0; i < flowerCount; i++) {
    let x: number, z: number
    do { x = random() * 45 - 30; z = random() * 40 - 13 }
    while (Math.hypot(x - 7, z + 16) < 9.5 || Math.abs(x + .478 * z + .3) < .7)
    const height = .5 + random() * .35, y = terrainHeight(x, z)
    dummy.rotation.set(0, 0, 0); dummy.position.set(x, y + height / 2, z); dummy.scale.set(.003, height, .003); dummy.updateMatrix(); stems.setMatrixAt(i, dummy.matrix)
    dummy.position.set(x, y + height, z); dummy.scale.set(.013, .006, .013); dummy.updateMatrix(); centers.setMatrixAt(i, dummy.matrix)
    for (let petal = 0; petal < 6; petal++) {
      const angle = petal / 6 * Math.PI * 2
      dummy.position.set(x + Math.cos(angle) * .027, y + height - .002, z + Math.sin(angle) * .027)
      dummy.rotation.set(0, -angle, .12); dummy.scale.set(.031, .004, .011); dummy.updateMatrix(); petals.setMatrixAt(i * 6 + petal, dummy.matrix)
    }
  }
  scene.add(petals, centers, stems)

  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .18, .55, 1.6)
  const output = new OutputPass()
  composer.addPass(renderPass); composer.addPass(bloom); composer.addPass(output)
  let disposed = false, motion = true, visible = true, lost = false, frame = 0, time = 0, lastTime = 0, progress = 0, cameraProgress = 0
  const viewTarget = new THREE.Vector3()
  const fieldPosition = new THREE.Vector3(-10, 2.65 + terrainHeight(-10, 16), 16)
  const libraryPosition = new THREE.Vector3(-7.5, 3.4, 5)
  const deskPosition = new THREE.Vector3(1.1, 2.45, -4.4)
  const fieldLook = new THREE.Vector3(-31, .9, -12)
  const libraryLook = new THREE.Vector3(1.4, 2.7, -18)
  const deskLook = new THREE.Vector3(4.7, 1.75, -9.7)
  function draw(now: number) {
    frame = 0
    if (disposed || lost || !visible || document.hidden) return
    const delta = Math.min((now - lastTime) / 1000, .05); lastTime = now
    if (motion) time += delta
    pointer.lerp(pointerTarget, .055)
    wind.value = time
    cameraProgress += (progress - cameraProgress) * (motion ? .10 : 1)
    const first = THREE.MathUtils.smoothstep(cameraProgress, .10, .61)
    const second = THREE.MathUtils.smoothstep(cameraProgress, .64, 1)
    camera.position.copy(fieldPosition).lerp(libraryPosition, first).lerp(deskPosition, second)
    viewTarget.copy(fieldLook).lerp(libraryLook, first).lerp(deskLook, second)
    if (camera.aspect < .85) {
      camera.position.z += first * 3.5 - second * 1.3
      viewTarget.x += first * 2.3 - second * 1.2
    }
    camera.position.x += pointer.x * (.7 - second * .35)
    camera.position.y += pointer.y * .20
    viewTarget.x += pointer.x * .27
    viewTarget.y += pointer.y * .10
    camera.lookAt(viewTarget)
    library.reels.forEach((reel, i) => { reel.rotation.z = -time * (.30 + i * .06) })
    library.drawer.position.z = .08 + THREE.MathUtils.smoothstep(cameraProgress, .38, .80) * .33
    composer.render()
    host.dataset.renderer = 'ready'
    if (motion) schedule()
  }
  function schedule() { if (!frame && !disposed && !lost && visible && !document.hidden) frame = requestAnimationFrame(draw) }
  function resize() {
    const width = host.clientWidth, height = host.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height)
    composer.setSize(width, height)
    camera.aspect = width / height
    camera.fov = width < 700 ? 61 : 48
    camera.updateProjectionMatrix()
    schedule()
  }
  const sizeObserver = new ResizeObserver(resize); sizeObserver.observe(host)
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (!visible) { cancelAnimationFrame(frame); frame = 0 }
    else { lastTime = performance.now(); schedule() }
  }); visibilityObserver.observe(host)
  const onVisibility = () => { cancelAnimationFrame(frame); frame = 0; lastTime = performance.now(); schedule() }
  const onContextLost = (event: Event) => { event.preventDefault(); lost = true; cancelAnimationFrame(frame); frame = 0; host.dataset.renderer = 'fallback' }
  document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onContextLost)
  renderer.shadowMap.needsUpdate = true
  resize()
  return {
    setProgress(value) { progress = value; schedule() },
    setPointer(x, y) { if (motion) { pointerTarget.set(x, y); schedule() } },
    setMotion(enabled) {
      motion = enabled
      if (!enabled) { pointer.set(0, 0); pointerTarget.set(0, 0); cancelAnimationFrame(frame); frame = 0 }
      lastTime = performance.now(); host.dataset.motion = enabled ? 'running' : 'paused'; schedule()
    },
    dispose() {
      disposed = true; cancelAnimationFrame(frame)
      sizeObserver.disconnect(); visibilityObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      const geometries = new Set<THREE.BufferGeometry>(), materialSet = new Set<THREE.Material>(), textures = new Set<THREE.Texture>()
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry)
          const list = Array.isArray(object.material) ? object.material : [object.material]
          list.forEach((material) => materialSet.add(material))
          if (object instanceof THREE.InstancedMesh) object.dispose()
        }
      })
      Object.values(materials).forEach((material) => materialSet.add(material))
      materialSet.forEach((material) => { Object.values(material).forEach((value) => { if (value instanceof THREE.Texture) textures.add(value) }); material.dispose() })
      geometries.forEach((geometry) => geometry.dispose()); textures.forEach((texture) => texture.dispose())
      sun.shadow.dispose(); environmentTarget.dispose(); bloom.dispose(); output.dispose(); composer.dispose()
      renderer.dispose(); renderer.forceContextLoss(); canvas.remove()
    },
  }
}
