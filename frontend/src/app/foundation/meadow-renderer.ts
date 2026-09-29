import * as THREE from 'three'

export type MeadowRenderer = {
  setProgress: (value: number) => void
  setPointer: (x: number, y: number) => void
  setMotion: (enabled: boolean) => void
  dispose: () => void
}

// The photographs carry material detail; instanced foreground blades supply real
// perspective and wind. Architecture stays rigid instead of rippling with grass.
export function createMeadowRenderer(
  host: HTMLDivElement,
  sources: { meadow: string; library: string },
): MeadowRenderer {
  const compact = window.matchMedia('(max-width: 760px)').matches
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: 'low-power' })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, compact ? 1.25 : 1.5))
  renderer.autoClear = false
  renderer.setClearColor(0x000000, 0)
  const canvas = renderer.domElement
  canvas.setAttribute('aria-hidden', 'true')
  host.append(canvas)

  let disposed = false
  let motion = true
  let visible = true
  let loaded = 0
  let frame = 0
  let time = 0
  let lastTime = 0
  let width = 1
  let height = 1
  let progress = 0
  let contextLost = false
  const pointer = new THREE.Vector2()
  const targetPointer = new THREE.Vector2()
  const textures: THREE.Texture[] = []
  const loader = new THREE.TextureLoader()
  const uniforms = {
    uMeadow: { value: null as THREE.Texture | null },
    uLibrary: { value: null as THREE.Texture | null },
    uSize: { value: new THREE.Vector2(1, 1) },
    uMeadowSize: { value: new THREE.Vector2(16, 9) },
    uLibrarySize: { value: new THREE.Vector2(16, 9) },
    uTime: { value: 0 },
    uPointer: { value: pointer },
    uProgress: { value: 0 },
  }
  const background = new THREE.Scene()
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const screenGeometry = new THREE.PlaneGeometry(2, 2)
  const screenMaterial = new THREE.ShaderMaterial({
    uniforms,
    depthTest: false,
    depthWrite: false,
    vertexShader: `varying vec2 vUv;
      void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uMeadow, uLibrary;
      uniform vec2 uSize, uMeadowSize, uLibrarySize, uPointer;
      uniform float uTime, uProgress;
      varying vec2 vUv;
      vec2 cover(vec2 p, vec2 imageSize) {
        float screenAspect = uSize.x / uSize.y;
        float imageAspect = imageSize.x / imageSize.y;
        return (p - .5) * vec2(min(screenAspect / imageAspect, 1.0), min(imageAspect / screenAspect, 1.0)) + .5;
      }
      void main() {
        float passage = smoothstep(.16, .68, uProgress);
        float depth = pow(1.0 - vUv.y, 2.0);
        vec2 parallax = uPointer * vec2(.007, .004) * (.22 + depth);
        vec2 view = (vUv - .5) / (1.025 + .055 * uProgress) + .5 + parallax;
        vec2 meadowUv = cover(view, uMeadowSize);
        float windMask = 1.0 - smoothstep(.15, .58, vUv.y);
        meadowUv.x += sin(meadowUv.y * 34.0 + meadowUv.x * 8.0 - uTime * .65) * .00075 * windMask;
        meadowUv.y += sin(meadowUv.x * 26.0 - uTime * .45) * .0003 * windMask;
        vec3 meadow = texture2D(uMeadow, meadowUv).rgb;
        vec2 libraryUv = cover(view, uLibrarySize);
        // On portrait screens favor the shelves, while copy has its own shade.
        libraryUv.x += (1.0 - min(uSize.x / uSize.y, 1.0)) * .14;
        vec3 library = texture2D(uLibrary, libraryUv).rgb;
        vec3 color = mix(meadow, library, passage);
        float vignette = 1.0 - .25 * pow(length((vUv - .5) * vec2(.9, 1.0)), 1.4);
        color *= vignette;
        gl_FragColor = vec4(color, 1.0);
      }`,
  })
  background.add(new THREE.Mesh(screenGeometry, screenMaterial))

  const field = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(48, 1, .1, 65)
  camera.position.set(0, 2.8, 7)
  camera.lookAt(0, 1.65, -9)
  const bladeGeometry = new THREE.InstancedBufferGeometry()
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i <= 5; i++) {
    const t = i / 5
    positions.push(-(1 - t) * .5, t, 0, (1 - t) * .5, t, 0)
    uvs.push(0, t, 1, t)
    if (i < 5) { const n = i * 2; indices.push(n, n + 1, n + 2, n + 1, n + 3, n + 2) }
  }
  bladeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  bladeGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  bladeGeometry.setIndex(indices)
  const count = compact ? 4500 : 11000
  const offsets = new Float32Array(count * 3)
  const shapes = new Float32Array(count * 3)
  let seed = 83
  const random = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
  for (let i = 0; i < count; i++) {
    const x = (random() - .5) * 30
    const z = random() * 23 - 18
    // A low foreground bank leaves the horizon and library unobscured.
    offsets.set([x, -.7 + .15 * Math.sin(x * .25 + z * .2), z], i * 3)
    shapes.set([.018 + random() * .025, .22 + random() * .48, random() * Math.PI], i * 3)
  }
  bladeGeometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3))
  bladeGeometry.setAttribute('aShape', new THREE.InstancedBufferAttribute(shapes, 3))
  bladeGeometry.instanceCount = count
  const grassMaterial = new THREE.ShaderMaterial({
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      attribute vec3 aOffset, aShape;
      uniform float uTime;
      uniform vec2 uPointer;
      varying float vHeight, vDepth, vLight;
      void main() {
        float h = uv.y;
        float wave = sin(aOffset.x * .43 + aOffset.z * .31 - uTime * .92);
        float ripple = sin(aOffset.x * 1.35 - aOffset.z * .5 + uTime * 1.35) * .2;
        float nearby = exp(-length(aOffset.xz - vec2(uPointer.x * 9.0, 3.0)) * .35);
        vec3 p = vec3(position.x * aShape.x, position.y * aShape.y, 0.0);
        p.xz = mat2(cos(aShape.z), -sin(aShape.z), sin(aShape.z), cos(aShape.z)) * p.xz;
        p.x += h * h * (.14 + wave * .14 + ripple * .08 + nearby * uPointer.x * .18);
        p.z += h * h * (.08 + wave * .07);
        p += aOffset;
        vHeight = h;
        vLight = .65 + .35 * sin(aShape.z + aOffset.x);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uProgress;
      varying float vHeight, vDepth, vLight;
      void main() {
        vec3 base = vec3(.026, .043, .033);
        vec3 tip = vec3(.20, .24, .17) * vLight;
        vec3 color = mix(base, tip, pow(vHeight, 1.6));
        float alpha = (1.0 - smoothstep(7.0, 24.0, vDepth)) * mix(.88, .32, smoothstep(.16, .68, uProgress));
        gl_FragColor = vec4(color, alpha);
      }`,
  })
  const grass = new THREE.Mesh(bladeGeometry, grassMaterial)
  grass.frustumCulled = false
  field.add(grass)

  function draw(now: number) {
    frame = 0
    if (disposed || contextLost || !visible || document.hidden || loaded < 2) return
    const delta = Math.min((now - lastTime) / 1000, .05)
    lastTime = now
    if (motion) time += delta
    pointer.lerp(motion ? targetPointer : new THREE.Vector2(), .055)
    uniforms.uTime.value = time
    uniforms.uProgress.value = progress
    camera.position.x = pointer.x * .16
    camera.position.y = 2.8 + pointer.y * .055
    camera.lookAt(pointer.x * .08, 1.65, -9)
    renderer.clear()
    renderer.render(background, ortho)
    renderer.clearDepth()
    renderer.render(field, camera)
    if (motion) requestDraw()
  }
  function requestDraw() {
    if (!frame && !disposed && !contextLost && visible && !document.hidden) frame = requestAnimationFrame(draw)
  }
  function resize() {
    width = host.clientWidth
    height = host.clientHeight
    if (!width || !height) return
    renderer.setSize(width, height)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    uniforms.uSize.value.set(width, height)
    requestDraw()
  }
  const sizeObserver = new ResizeObserver(resize)
  sizeObserver.observe(host)
  const visibilityObserver = new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting
    if (visible) { lastTime = performance.now(); requestDraw() }
    else { cancelAnimationFrame(frame); frame = 0 }
  })
  visibilityObserver.observe(host)
  const onVisibility = () => {
    cancelAnimationFrame(frame); frame = 0
    lastTime = performance.now()
    requestDraw()
  }
  const onContextLost = (event: Event) => {
    event.preventDefault()
    contextLost = true
    cancelAnimationFrame(frame); frame = 0
    host.dataset.renderer = 'fallback'
  }
  document.addEventListener('visibilitychange', onVisibility)
  canvas.addEventListener('webglcontextlost', onContextLost)
  for (const name of ['meadow', 'library'] as const) {
    const texture = loader.load(sources[name], (loadedTexture) => {
      if (disposed) { loadedTexture.dispose(); return }
      const image = loadedTexture.image as HTMLImageElement
      uniforms[name === 'meadow' ? 'uMeadowSize' : 'uLibrarySize'].value.set(image.width, image.height)
      loaded++
      if (loaded === 2) { host.dataset.renderer = 'ready'; requestDraw() }
    }, undefined, () => { host.dataset.renderer = 'fallback' })
    // The custom screen shader displays source sRGB directly, without lighting.
    texture.minFilter = THREE.LinearFilter
    texture.generateMipmaps = false
    textures.push(texture)
    uniforms[name === 'meadow' ? 'uMeadow' : 'uLibrary'].value = texture
  }
  resize()
  return {
    setProgress(value) { progress = value; requestDraw() },
    setPointer(x, y) { targetPointer.set(x, y); if (motion) requestDraw() },
    setMotion(enabled) {
      motion = enabled
      if (!enabled) { pointer.set(0, 0); targetPointer.set(0, 0); cancelAnimationFrame(frame); frame = 0 }
      lastTime = performance.now()
      host.dataset.motion = enabled ? 'running' : 'paused'
      requestDraw()
    },
    dispose() {
      disposed = true
      cancelAnimationFrame(frame)
      sizeObserver.disconnect()
      visibilityObserver.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      canvas.removeEventListener('webglcontextlost', onContextLost)
      textures.forEach((texture) => texture.dispose())
      screenGeometry.dispose(); screenMaterial.dispose()
      bladeGeometry.dispose(); grassMaterial.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      canvas.remove()
    },
  }
}
