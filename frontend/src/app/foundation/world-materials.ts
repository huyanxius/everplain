import * as THREE from 'three'

export function randomSequence(seed = 71) {
  return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }
}

export function terrainHeight(x: number, z: number) {
  const distance = Math.hypot(x - 7, z + 16)
  const outside = THREE.MathUtils.smoothstep(distance, 9, 13)
  const hills = Math.sin(x * .11 + z * .055) * .65 + Math.sin(z * .14 - x * .07) * .45
    + Math.sin(x * .045 + 1.4) * Math.cos(z * .04) * 2.1
  return hills * outside - .06
}

export function createWorldMaterials() {
  const random = randomSequence()
  const texture = (kind: 'wood' | 'stone' | 'paper') => {
    const w = 128, h = 512
    const pixels = new Uint8Array(w * h * 4)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const grain = kind === 'wood'
        ? 171 + 22 * Math.sin(x * .6 + Math.sin(y * .017) * 2) + 13 * Math.sin(x * 2.3 + Math.sin(y * .03))
        : kind === 'paper' ? 222 - (y % 5 === 0 ? 42 : 0) : 188 + Math.sin(x * .07) * Math.cos(y * .05) * 18
      const value = Math.min(255, Math.max(0, grain + (random() - .5) * (kind === 'stone' ? 30 : 13)))
      const i = (y * w + x) * 4
      pixels[i] = value; pixels[i + 1] = value; pixels[i + 2] = value; pixels[i + 3] = 255
    }
    const map = new THREE.DataTexture(pixels, w, h)
    map.colorSpace = THREE.SRGBColorSpace
    map.wrapS = map.wrapT = THREE.RepeatWrapping
    map.magFilter = THREE.LinearFilter
    map.minFilter = THREE.LinearMipmapLinearFilter
    map.generateMipmaps = true
    map.needsUpdate = true
    return map
  }
  const woodMap = texture('wood'), stoneMap = texture('stone'), paperMap = texture('paper')
  const soilMap = stoneMap.clone()
  soilMap.repeat.set(95, 95)
  return {
    wood: new THREE.MeshStandardMaterial({ color: '#78533a', map: woodMap, bumpMap: woodMap, bumpScale: .017, roughness: .72 }),
    darkWood: new THREE.MeshStandardMaterial({ color: '#473123', map: woodMap, roughness: .86 }),
    concrete: new THREE.MeshStandardMaterial({ color: '#99968a', map: stoneMap, bumpMap: stoneMap, bumpScale: .035, roughness: .93 }),
    soil: new THREE.MeshStandardMaterial({ color: '#536d34', map: soilMap, roughness: 1 }),
    paper: new THREE.MeshStandardMaterial({ color: '#eee1bb', map: paperMap, roughness: .95 }),
    linen: new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: .86 }),
    silver: new THREE.MeshStandardMaterial({ color: '#b7b7a7', metalness: .88, roughness: .29 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b9a172', metalness: .8, roughness: .33 }),
    black: new THREE.MeshStandardMaterial({ color: '#1b201c', metalness: .24, roughness: .64 }),
    glow: new THREE.MeshStandardMaterial({ color: '#ffe2a6', emissive: '#ffc16b', emissiveIntensity: 4, roughness: .3 }),
  }
}
export type WorldMaterials = ReturnType<typeof createWorldMaterials>
