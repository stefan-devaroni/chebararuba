// Che Bar pizza turntable (chebararuba.com/concept/): five dishes on a wooden lazy Susan, turned by scrolling.
// The pizzas and the empanadas are the real VapVap photos, straightened to a top-down view, with heights from
// height maps (raised crust, burrata, arugula, toppings) built into the meshes. Everything else is made here.
import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'

const canvas = document.getElementById('gl')
const coarse = matchMedia('(pointer: coarse)').matches
const small = coarse || Math.min(innerWidth, innerHeight) < 700 || location.search.includes('phone') // ?phone forces the phone version for testing
const Q = small
  ? { tex: '-1k', nR: 96, nA: 256, grid: 150, shadow: 1024, dpr: Math.min(devicePixelRatio, 1.6), wood: 1024 }
  : { tex: '', nR: 150, nA: 400, grid: 230, shadow: 2048, dpr: Math.min(devicePixelRatio, 2), wood: 2048 }

const RING = 2.55 // dishes sit this far from the turntable's centre (1 unit = a pizza's radius, about 15 cm)
const TT = 3.95 // turntable radius
const TH = 0.26 // turntable thickness
const MARGIN = 1.06 // pizza textures cover the disc times this
const ITEMS = ['pepperoni', 'margherita', 'prosciutto', 'hawaiian', 'empanadas']
const STEP = (Math.PI * 2) / ITEMS.length

let renderer
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
} catch (e) {
  document.documentElement.classList.add('no-gl')
  throw e
}
renderer.setPixelRatio(Q.dpr)
renderer.setSize(innerWidth, innerHeight, false)
renderer.outputColorSpace = THREE.SRGBColorSpace
renderer.toneMapping = THREE.NeutralToneMapping
renderer.toneMappingExposure = 1.0
renderer.shadowMap.enabled = true
renderer.shadowMap.type = small ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
const BG = 0x0d0907
scene.background = new THREE.Color(BG)
scene.fog = new THREE.Fog(BG, 11, 26)
const pmrem = new THREE.PMREMGenerator(renderer)
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
scene.environmentIntensity = 0.28

const camera = new THREE.PerspectiveCamera(32, innerWidth / innerHeight, 0.1, 120)

// a camera-like soft focus on bigger screens: sharp on the front dish, softer further away (loaded only there)
let composer = null, bokeh = null
async function softFocus() {
  if (small) return
  const [{ EffectComposer }, { RenderPass }, { BokehPass }, { OutputPass }] = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
    import('three/addons/postprocessing/BokehPass.js'), import('three/addons/postprocessing/OutputPass.js')])
  const c = new EffectComposer(renderer)
  c.addPass(new RenderPass(scene, camera))
  bokeh = new BokehPass(scene, camera, { focus: 8, aperture: 0.0014, maxblur: 0.005 })
  c.addPass(bokeh)
  c.addPass(new OutputPass())
  composer = c
}

// ---------- loading ----------
const manager = new THREE.LoadingManager()
const bar = document.querySelector('#loader i')
manager.onProgress = (_, done, total) => { if (bar) bar.style.transform = `scaleX(${done / total})` }
const texturesDone = new Promise((res) => { manager.onLoad = res })
const tl = new THREE.TextureLoader(manager)
const maxAniso = renderer.capabilities.getMaxAnisotropy()
const A = 'assets/'
function tex(url, srgb = true) {
  const t = tl.load(url)
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = maxAniso
  return t
}
function image(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
}
async function heights(url) { // a grey PNG -> bytes
  const img = await image(url)
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0)
  const d = g.getImageData(0, 0, c.width, c.height).data, out = new Uint8Array(c.width * c.height)
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4]
  return { data: out, size: c.width }
}
function sample(h, x, y) { // bilinear, pixel coordinates
  const s = h.size, x0 = Math.max(0, Math.min(s - 2, Math.floor(x))), y0 = Math.max(0, Math.min(s - 2, Math.floor(y)))
  const fx = Math.min(1, Math.max(0, x - x0)), fy = Math.min(1, Math.max(0, y - y0)), d = h.data, i = y0 * s + x0
  return (d[i] * (1 - fx) + d[i + 1] * fx) * (1 - fy) + (d[i + s] * (1 - fx) + d[i + s + 1] * fx) * fy
}

// ---------- meshes ----------
function pizzaGeometry(h, hmax) {
  const { nR, nA } = Q, cols = nA + 1
  const pos = new Float32Array((nR + 1) * cols * 3), uv = new Float32Array((nR + 1) * cols * 2), idx = []
  let p = 0, q = 0
  for (let i = 0; i <= nR; i++) {
    const s = i / nR, r = (s < 0.4 ? (0.72 * s) / 0.4 : 0.72 + (0.28 * (s - 0.4)) / 0.6) * MARGIN // more rings over the crust
    for (let j = 0; j <= nA; j++) {
      const a = (j / nA) * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r
      const u = (x / MARGIN + 1) / 2, v = (z / MARGIN + 1) / 2
      pos[p++] = x; pos[p++] = (sample(h, u * h.size - 0.5, v * h.size - 0.5) / 255) * hmax; pos[p++] = z
      uv[q++] = u; uv[q++] = 1 - v
    }
  }
  // seen from above, the steep outside of the crust gets almost no photo; give it texture in proportion to its surface
  const radius = (k) => Math.hypot(pos[k * 3], pos[k * 3 + 2])
  for (let j = 0; j <= nA; j++) {
    let peak = -1, top = -1
    for (let i = 0; i <= nR; i++) { const k = i * cols + j; if (radius(k) > 0.75 && pos[k * 3 + 1] > top) { top = pos[k * 3 + 1]; peak = i } }
    let edge = peak; while (edge < nR && pos[(edge * cols + j) * 3 + 1] > 0.004) edge++
    if (peak < 0 || edge - peak < 2) continue
    const L = [0]
    for (let i = peak + 1; i <= edge; i++) {
      const a = (i - 1) * cols + j, b = i * cols + j
      L.push(L[L.length - 1] + Math.hypot(radius(b) - radius(a), pos[b * 3 + 1] - pos[a * 3 + 1]))
    }
    const r0 = radius(peak * cols + j), r1 = radius(edge * cols + j), ang = (j / nA) * Math.PI * 2
    for (let i = peak + 1; i <= edge; i++) {
      const ruv = r0 + (r1 - r0) * (L[i - peak] / L[L.length - 1]), k = (i * cols + j) * 2
      uv[k] = (Math.cos(ang) * ruv / MARGIN + 1) / 2; uv[k + 1] = 1 - (Math.sin(ang) * ruv / MARGIN + 1) / 2
    }
  }
  for (let i = 0; i < nR; i++) for (let j = 0; j < nA; j++) { const a = i * cols + j, b = a + cols; idx.push(a, a + 1, b, b, a + 1, b + 1) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  // weld the seam and the centre so there is no shading line
  const n = g.attributes.normal.array, v3 = new THREE.Vector3(), c = new THREE.Vector3()
  for (let i = 0; i <= nR; i++) {
    const a = i * cols * 3, b = (i * cols + nA) * 3
    v3.set(n[a] + n[b], n[a + 1] + n[b + 1], n[a + 2] + n[b + 2]).normalize()
    n[a] = n[b] = v3.x; n[a + 1] = n[b + 1] = v3.y; n[a + 2] = n[b + 2] = v3.z
  }
  for (let j = 0; j <= nA; j++) { const k = (cols + j) * 3; c.x += n[k]; c.y += n[k + 1]; c.z += n[k + 2] }
  c.normalize()
  for (let j = 0; j <= nA; j++) { const k = j * 3; n[k] = c.x; n[k + 1] = c.y; n[k + 2] = c.z }
  return g
}

function gridGeometry(h, hmax, size) { // for the empanada basket: a square grid lifted by the height map
  const n = Q.grid, cols = n + 1, pos = new Float32Array(cols * cols * 3), uv = new Float32Array(cols * cols * 2), idx = []
  let p = 0, q = 0
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) {
    const u = j / n, v = i / n
    pos[p++] = (u - 0.5) * size; pos[p++] = (sample(h, u * h.size - 0.5, v * h.size - 0.5) / 255) * hmax; pos[p++] = (v - 0.5) * size
    uv[q++] = u; uv[q++] = 1 - v
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { const a = i * cols + j, b = a + cols; idx.push(a, b, a + 1, b, b + 1, a + 1) }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  g.setIndex(idx)
  g.computeVertexNormals()
  return g
}

const plateGeometry = (() => { // white plate, lathed: flat well, low rim, rolled lip, foot underneath
  const pts = [[0, -0.075], [0.66, -0.075], [0.68, -0.05], [0.9, -0.04], [1.05, -0.005], [1.11, 0.045], [1.125, 0.056],
    [1.117, 0.066], [1.097, 0.062], [1.06, 0.036], [1.03, 0.006], [1.0, 0.0], [0, 0.0]]
  return new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), 128)
})()
const plateMat = small
  ? new THREE.MeshStandardMaterial({ color: 0xf3efe8, roughness: 0.22, side: THREE.DoubleSide })
  : new THREE.MeshPhysicalMaterial({ color: 0xf3efe8, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide })
const contact = (() => { // a soft dark patch under each dish, where the light can't reach
  const c = document.createElement('canvas'); c.width = c.height = 256
  const g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128)
  grd.addColorStop(0, 'rgba(0,0,0,0.62)'); grd.addColorStop(0.55, 'rgba(0,0,0,0.42)'); grd.addColorStop(0.8, 'rgba(0,0,0,0.12)'); grd.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256)
  return new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
})()
function contactShadow(w, d) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), contact)
  m.rotation.x = -Math.PI / 2; m.position.y = 0.004; m.renderOrder = 1
  return m
}

function alphaDepth(map) {
  return new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: 0.5 })
}

async function woodTexture() {
  const img = await image(`${A}wood${Q.tex}.webp`)
  await Promise.all([document.fonts.load('600 100px Cinzel'), document.fonts.load('italic 400 100px "Cormorant Garamond"')]).catch(() => {})
  const S = Q.wood, c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  g.drawImage(img, 0, 0, S, S)
  // the table's stencil, like on the real Che Bar tables: CHE BAR / Aruba, a little worn
  const t = document.createElement('canvas'); t.width = t.height = S
  const k = t.getContext('2d')
  k.fillStyle = '#1a110b'; k.textAlign = 'center'; k.textBaseline = 'alphabetic'
  k.font = '600 100px Cinzel'; if ('letterSpacing' in k) k.letterSpacing = '6px'
  const big = (S * 0.4) / k.measureText('CHE BAR').width * 100
  k.font = `600 ${big}px Cinzel`; if ('letterSpacing' in k) k.letterSpacing = `${big * 0.06}px`
  k.fillText('CHE BAR', S / 2, S * 0.5)
  k.font = `italic 400 ${big * 0.55}px "Cormorant Garamond"`; if ('letterSpacing' in k) k.letterSpacing = `${big * 0.04}px`
  k.fillText('Aruba', S / 2, S * 0.5 + big * 0.62)
  k.globalCompositeOperation = 'destination-out'
  for (let i = 0; i < (small ? 1800 : 5200); i++) {
    k.globalAlpha = 0.15 + Math.random() * 0.6
    k.beginPath(); k.arc(S * (0.22 + Math.random() * 0.56), S * (0.38 + Math.random() * 0.24), Math.random() * S * 0.0022 + 0.4, 0, 7); k.fill()
  }
  g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.9
  g.drawImage(t, 0, 0)
  const tx = new THREE.CanvasTexture(c)
  tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = maxAniso
  return tx
}

// ---------- scene ----------
const table = new THREE.Group() // the turntable and everything on it; turned by scrolling
scene.add(table)
const lights = { key: new THREE.SpotLight(0xffe6cc, 4.3, 0, Math.PI / 6.5, 0.75, 0) }

async function build() {
  const meta = await (await fetch(`${A}meta.json`)).json()
  const [hs, woodTex] = await Promise.all([Promise.all(ITEMS.map((n) => heights(`${A}${n}-height.png`))), woodTexture()])

  // turntable: top with the stencilled wood, a rounded edge, on a dark table
  const top = new THREE.Mesh(new THREE.CircleGeometry(TT, 160), new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.62 }))
  top.rotation.x = -Math.PI / 2; top.position.y = 0; top.receiveShadow = true
  table.add(top)
  const edgeTex = woodTex.clone(); edgeTex.wrapS = THREE.RepeatWrapping; edgeTex.repeat.set(4, 0.08); edgeTex.needsUpdate = true
  const edgePts = [[TT - 0.02, 0.0], [TT, -0.012], [TT + 0.018, -0.05], [TT + 0.02, -TH + 0.05], [TT, -TH + 0.01], [TT - 0.05, -TH]]
  const edge = new THREE.Mesh(new THREE.LatheGeometry(edgePts.map(([x, y]) => new THREE.Vector2(x, y)), 160),
    new THREE.MeshStandardMaterial({ map: edgeTex, color: 0xb59a86, roughness: 0.55, side: THREE.DoubleSide }))
  edge.castShadow = true; edge.receiveShadow = true
  table.add(edge)
  table.position.y = 0

  const floorTex = woodTex.clone(); floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(5, 5); floorTex.needsUpdate = true
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ map: floorTex, color: 0x6a5a50, roughness: 0.8 }))
  floor.rotation.x = -Math.PI / 2; floor.position.y = -TH; floor.receiveShadow = true
  scene.add(floor)

  // dishes
  ITEMS.forEach((name, i) => {
    const dish = new THREE.Group(), a = i * STEP
    dish.position.set(Math.sin(a) * RING, 0, Math.cos(a) * RING)
    dish.rotation.y = a
    const color = tex(`${A}${name}-color${Q.tex}.webp`)
    if (name === 'empanadas') {
      const mat = new THREE.MeshStandardMaterial({ map: color, normalMap: tex(`${A}${name}-normal${Q.tex}.webp`, false),
        roughnessMap: tex(`${A}${name}-orm${Q.tex}.webp`, false), roughness: 1, alphaTest: 0.5, side: THREE.DoubleSide })
      mat.normalScale.set(0.8, 0.8)
      dish.add(contactShadow(2.5, 1.9))
      const basket = new THREE.Mesh(gridGeometry(hs[i], meta[name].hmax, 2.15), mat)
      basket.castShadow = basket.receiveShadow = true
      basket.customDepthMaterial = alphaDepth(color)
      dish.add(basket)
    } else {
      dish.add(contactShadow(2.9, 2.9))
      const plate = new THREE.Mesh(plateGeometry, plateMat)
      plate.castShadow = plate.receiveShadow = true
      plate.position.y = 0.075
      dish.add(plate)
      const mat = new THREE.MeshStandardMaterial({ map: color, normalMap: tex(`${A}${name}-normal${Q.tex}.webp`, false),
        roughnessMap: tex(`${A}${name}-orm${Q.tex}.webp`, false), roughness: 1, alphaTest: 0.5 })
      mat.normalScale.set(0.95, 0.95)
      const pizza = new THREE.Mesh(pizzaGeometry(hs[i], meta[name].hmax), mat)
      pizza.castShadow = pizza.receiveShadow = true
      pizza.customDepthMaterial = alphaDepth(color)
      pizza.position.y = 0.078
      dish.add(pizza)
    }
    table.add(dish)
  })

  // light: a warm spot on the front dish, a soft fill, a warm back light for the crust edges
  scene.add(new THREE.HemisphereLight(0xffe4c8, 0x24170f, 0.3))
  const key = lights.key
  key.castShadow = true
  key.shadow.mapSize.set(Q.shadow, Q.shadow)
  key.shadow.bias = -0.0002; key.shadow.normalBias = 0.025
  key.shadow.camera.near = 2; key.shadow.camera.far = 26
  scene.add(key, key.target)
  const back = new THREE.DirectionalLight(0xffc28a, 1.7); back.position.set(3, 3.2, -6); scene.add(back)
  const side = new THREE.DirectionalLight(0xffdcc0, 0.25); side.position.set(6, 2.5, 3); scene.add(side)
}

// ---------- scroll story ----------
// stops: -1 hero on the pepperoni, 0..4 the five dishes, 5 the whole table from above
const FIRST = -1, LAST = 5
const scroller = document.getElementById('scroll')
function targetStop() {
  const max = scroller.offsetHeight - innerHeight
  const f = Math.min(1, Math.max(0, scrollY / Math.max(1, max))) * (LAST - FIRST)
  const k = Math.min(LAST - FIRST - 1, Math.floor(f)), t = f - k
  const e = Math.min(1, Math.max(0, (t - 0.22) / 0.56)) // hold at each dish, then turn
  return FIRST + k + e * e * (3 - 2 * e)
}
let sNow = targetStop(), sGoal = sNow

const caps = [...document.querySelectorAll('[data-s]')]
const dots = [...document.querySelectorAll('.dots button')]
dots.forEach((d, i) => d.addEventListener('click', () => {
  const max = scroller.offsetHeight - innerHeight
  scrollTo({ top: ((i - FIRST + 0.0) / (LAST - FIRST)) * max, behavior: 'smooth' })
}))

const lerp = (a, b, t) => a + (b - a) * t
const ease = (t) => t * t * (3 - 2 * t)
function shot(s, portrait) {
  // where the camera looks and how much it shows, per stop; in between it blends
  const hero = portrait ? { tx: 0, tz: RING + 0.5, el: 40, w: 2.45, h: 2.15 } : { tx: -0.8, tz: RING + 0.05, el: 34, w: 4.4, h: 2.55 }
  const item = portrait ? { tx: 0, tz: RING + 0.62, el: 46, w: 2.7, h: 2.55 } : { tx: -1.05, tz: RING - 0.05, el: 40, w: 4.5, h: 2.8 }
  const over = portrait ? { tx: 0, tz: 0.9, el: 78, w: 8.6, h: 8.6 } : { tx: -1.6, tz: 0, el: 70, w: 11.5, h: 8.9 }
  let a, b, t
  if (s < 0) { a = hero; b = item; t = ease(s + 1) } else if (s > 4) { a = item; b = over; t = ease(s - 4) } else { a = b = item; t = 0 }
  const f = (k) => lerp(a[k], b[k], t)
  const breathe = s > 0 && s < 4 ? 1 + 0.1 * Math.sin(Math.PI * (s - Math.floor(s))) : 1 // pull back a little while turning
  return { tx: f('tx'), tz: f('tz'), el: f('el'), w: f('w') * breathe, h: f('h') * breathe }
}

const clock = new THREE.Clock()
let still = null // { w, h } while rendering the opening still (see __table.poster)
function draw() {
  const dt = Math.min(0.05, clock.getDelta()), time = still ? 0 : clock.elapsedTime
  sNow += (sGoal - sNow) * (1 - Math.exp(-dt * 5.5))
  const s = sNow

  table.rotation.y = -Math.min(LAST, Math.max(0, s)) * STEP

  const aspect = still ? still.w / still.h : innerWidth / innerHeight, portrait = aspect < 0.9
  camera.fov = portrait ? 44 : 32
  camera.aspect = aspect
  const sh = shot(s, portrait)
  const vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * aspect)
  const d = Math.max(sh.h / 2 / Math.tan(vf), sh.w / 2 / Math.tan(hf))
  const el = THREE.MathUtils.degToRad(sh.el)
  const sway = 0.035 * Math.sin(time * 0.35) // the room breathes a little
  camera.position.set(sh.tx + sway * d * 0.15, Math.sin(el) * d, sh.tz + Math.cos(el) * d)
  camera.lookAt(sh.tx, 0.05, sh.tz)
  camera.updateProjectionMatrix()
  scene.fog.near = d + 3; scene.fog.far = d + 17 // the table fades into the dark, whatever the camera distance

  // the key light follows from the front dish to the whole table
  const o = Math.max(0, Math.min(1, s - 4))
  lights.key.position.set(lerp(-4.0, -3, o), lerp(5.2, 14, o), lerp(RING + 3.6, 6, o))
  lights.key.target.position.set(0, 0, lerp(RING - 0.1, 0, o))
  lights.key.angle = lerp(Math.PI / 6.5, Math.PI / 4.2, o)
  lights.key.intensity = lerp(4.3, 3.2, o)

  // captions
  for (const c of caps) {
    const k = Math.max(0, 1 - Math.abs(s - Number(c.dataset.s)) * 2.4)
    c.style.opacity = k.toFixed(3)
    c.style.transform = `translateY(${((1 - k) * 18 * Math.sign(Number(c.dataset.s) - s)).toFixed(1)}px)`
    c.style.visibility = k > 0.01 ? 'visible' : 'hidden'
  }
  const active = Math.round(Math.min(4, Math.max(0, s)))
  dots.forEach((d, i) => d.classList.toggle('on', i === active && s > -0.5 && s < 4.5))
  document.documentElement.style.setProperty('--hint', Math.max(0, 1 - (s + 1) * 4).toFixed(3))

  if (composer && !(still && !still.focus)) {
    bokeh.uniforms.focus.value = camera.position.distanceTo(new THREE.Vector3(0, 0.1, lerp(RING, 0, o)))
    bokeh.uniforms.aperture.value = lerp(0.0016, 0.0004, o)
    composer.render()
  } else renderer.render(scene, camera)
}
function loop() { draw(); requestAnimationFrame(loop) }

// the opening shot as a still image at an exact size (used once to make assets/poster-*.webp; posts it to a local helper)
async function poster(w, h, name, focus = true, url = 'http://localhost:3999/save') {
  const keep = { pr: renderer.getPixelRatio(), s: sNow }
  still = { w, h, focus }; sGoal = sNow = FIRST
  renderer.setPixelRatio(1); renderer.setSize(w, h, false); if (composer) composer.setSize(w, h)
  draw()
  const done = new Promise((r) => canvas.toBlob(r, 'image/png')) // captures the canvas as it is right now
  still = null; sGoal = sNow = keep.s
  renderer.setPixelRatio(keep.pr); resize()
  const blob = await done
  const res = await fetch(`${url}?name=${encodeURIComponent(name)}`, { method: 'POST', body: blob })
  return `${name}: ${blob.size} bytes, ${res.status}`
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false)
  if (composer) composer.setSize(innerWidth, innerHeight)
}
addEventListener('resize', resize)
addEventListener('scroll', () => { sGoal = targetStop() }, { passive: true })

Promise.all([build(), softFocus().catch(() => {})]).then(async () => {
  sGoal = sNow = targetStop()
  await texturesDone // show the table only once every photo is on it
  // compile the shaders before showing anything, but never wait more than 2 s for it (it can stall in some browsers)
  try { await Promise.race([renderer.compileAsync(scene, camera), new Promise((r) => setTimeout(r, 2000))]) } catch (e) { /* compiles on the first frame */ }
  loop()
  setTimeout(() => document.documentElement.classList.add('ready'), 60)
}).catch((e) => {
  console.error(e)
  document.documentElement.classList.add('no-gl')
})

// for checking single moments in the console: __table.snap(2) shows the prosciutto
window.__table = { snap: (s) => { sGoal = sNow = s }, release: () => { sGoal = targetStop() }, poster, renderer, scene, camera, small, Q }
