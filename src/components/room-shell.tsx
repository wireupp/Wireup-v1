import { Canvas, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { hardwareApi } from '@/lib/hardware'
import type { HardwareComponent, HardwareProject, HardwareWire } from '@/lib/hardware'
import { RoomFocus } from './room-focus'
import kindsSource from '../../contracts/kinds.json?raw'
import capabilitySource from '../../contracts/capability.json?raw'

type CameraPreset = 'iso' | 'top' | 'front' | 'fit'
type Point = [number, number, number]
type KindDefinition = {
  id: string
  label: string
  group: string
  legacy_type?: string
  simulated: boolean
  scope: string
  ports: { name: string; type: string; direction: string }[]
}
type KindCapability = { id: string; exists: boolean; simulated: boolean; solver: string | null; confidence: string }
type RenderStatus = 'declared_support_unverified' | 'placement_only' | 'unrenderable'

const kindDefinitions = (JSON.parse(kindsSource) as { kinds: KindDefinition[] }).kinds
const capabilityDocument = JSON.parse(capabilitySource) as { generator_status: string; kinds: KindCapability[] }
const capabilities = capabilityDocument.kinds
const capabilitiesById = new Map(capabilities.map((capability) => [capability.id, capability]))

function resolveKind(type: string) {
  const matches = kindDefinitions.filter((kind) =>
    kind.legacy_type === type || kind.id === type || kind.id.endsWith(`.${type}`))
  return matches.length === 1 ? matches[0] : undefined
}

function renderStatus(kind: KindDefinition | undefined): RenderStatus {
  if (!kind) return 'unrenderable'
  const capability = capabilitiesById.get(kind.id)
  if (capability?.exists === false) return 'unrenderable'
  if (!kind.simulated || capability?.simulated !== true || !capability.solver) return 'placement_only'
  return 'declared_support_unverified'
}

function statusLabel(status: RenderStatus) {
  if (status === 'declared_support_unverified') return 'Declared support · unverified'
  if (status === 'placement_only') return 'Placement only'
  return 'Unrenderable kind'
}

function statusColor(status: RenderStatus) {
  if (status === 'declared_support_unverified') return '#1d7a58'
  if (status === 'placement_only') return '#9a6417'
  return '#a33a43'
}

const cameraPositions: Record<CameraPreset, Point> = {
  iso: [9, 9, 12],
  top: [0, 18, 0.01],
  front: [0, 5.5, 14],
  fit: [10, 10, 14],
}

function RoomCamera({ preset, zoom }: { preset: CameraPreset; zoom: number }) {
  const controls = useRef<OrbitControls | null>(null)
  const { camera, gl } = useThree()

  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement)
    orbit.enableDamping = true
    orbit.dampingFactor = 0.08
    orbit.enablePan = true
    orbit.enableZoom = true
    orbit.minDistance = 5
    orbit.maxDistance = 25
    orbit.maxPolarAngle = Math.PI / 2.02
    orbit.target.set(0, 1.15, 0)
    controls.current = orbit
    return () => {
      orbit.dispose()
      controls.current = null
    }
  }, [camera, gl])

  useEffect(() => {
    const position = cameraPositions[preset]
    camera.position.set(position[0] * zoom, position[1] * zoom, position[2] * zoom)
    camera.lookAt(0, 1.15, 0)
    controls.current?.target.set(0, 1.15, 0)
    controls.current?.update()
  }, [camera, preset, zoom])

  return null
}

function WindowFrame({ position, rotation = 0 }: { position: Point; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <mesh position={[0, 2.8, 0]}>
        <boxGeometry args={[4.2, 2.65, 0.12]} />
        <meshStandardMaterial color="#b9d9dc" />
      </mesh>
      <mesh position={[0, 2.8, 0.08]}>
        <boxGeometry args={[3.9, 2.35, 0.04]} />
        <meshStandardMaterial color="#bfe7f5" emissive="#dff6ff" emissiveIntensity={0.25} />
      </mesh>
      <mesh position={[0, 2.8, 0.12]}>
        <boxGeometry args={[0.09, 2.4, 0.06]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0, 2.8, 0.14]}>
        <boxGeometry args={[4, 0.09, 0.06]} />
        <meshStandardMaterial color="#f8fafc" />
      </mesh>
      <mesh position={[0, 1.53, 0.18]}>
        <boxGeometry args={[4.35, 0.15, 0.28]} />
        <meshStandardMaterial color="#e8eceb" />
      </mesh>
      <mesh position={[-1.4, 1.1, -0.65]} scale={[1.1, 0.65, 0.4]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color="#7faf6b" />
      </mesh>
      <mesh position={[1.35, 1.05, -0.75]} scale={[1.2, 0.6, 0.4]}>
        <sphereGeometry args={[1, 12, 8]} />
        <meshStandardMaterial color="#9acb77" />
      </mesh>
    </group>
  )
}

function Plant({ position, scale = 1 }: { position: Point; scale?: number }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.25, 0.34, 0.64, 16]} />
        <meshStandardMaterial color="#b6c4c8" roughness={0.7} />
      </mesh>
      {[-0.25, -0.08, 0.1, 0.27].map((x, index) => (
        <mesh key={x} position={[x, 1.03 + (index % 2) * 0.12, 0]} rotation={[0, 0, x * 0.8]}>
          <capsuleGeometry args={[0.08, 0.8, 4, 8]} />
          <meshStandardMaterial color={index % 2 ? '#8ebd91' : '#a4cda1'} />
        </mesh>
      ))}
    </group>
  )
}

function Stool({ position }: { position: Point }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.48, 0.48, 0.16, 24]} />
        <meshStandardMaterial color="#aeb8be" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[0.09, 0.12, 0.75, 12]} />
        <meshStandardMaterial color="#707d84" metalness={0.55} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.2, 0]}>
        <torusGeometry args={[0.35, 0.04, 8, 24]} />
        <meshStandardMaterial color="#87939a" metalness={0.5} />
      </mesh>
      {[0, 1, 2, 3].map((index) => (
        <mesh key={index} position={[Math.cos(index * Math.PI / 2) * 0.28, 0.08, Math.sin(index * Math.PI / 2) * 0.28]} rotation={[0, 0, Math.cos(index * Math.PI / 2) * 0.12]}>
          <boxGeometry args={[0.07, 0.32, 0.07]} />
          <meshStandardMaterial color="#758189" metalness={0.45} />
        </mesh>
      ))}
    </group>
  )
}

function RoomShellGeometry() {
  const floorTiles = useMemo(() => {
    const tiles: { position: Point; color: string }[] = []
    const colors = ['#e8d3ae', '#ecd9b7', '#e4cda4', '#efddbd']
    for (let row = 0; row < 18; row += 1) {
      for (let column = 0; column < 11; column += 1) {
        tiles.push({
          position: [-10 + column * 2 + (row % 2), 0, -8.5 + row],
          color: colors[(row * 7 + column) % colors.length],
        })
      }
    }
    return tiles
  }, [])

  return (
    <>
      <color attach="background" args={['#dce7e9']} />
      <fog attach="fog" args={['#dce7e9', 20, 45]} />
      <ambientLight intensity={1.45} />
      <directionalLight position={[4, 11, 6]} intensity={2.1} color="#fff9e9" />
      <hemisphereLight args={['#eaf8ff', '#c7b89f', 0.9]} />

      <mesh position={[0, -0.08, 0]} receiveShadow>
        <boxGeometry args={[22, 0.16, 18]} />
        <meshStandardMaterial color="#ead7b7" roughness={0.86} />
      </mesh>
      {floorTiles.map((tile, index) => (
        <mesh key={index} position={tile.position}>
          <boxGeometry args={[1.97, 0.018, 0.97]} />
          <meshStandardMaterial color={tile.color} roughness={0.86} />
        </mesh>
      ))}

      <mesh position={[0, 2.3, -9]} receiveShadow>
        <boxGeometry args={[22, 4.6, 0.2]} />
        <meshStandardMaterial color="#d8e7e6" roughness={0.9} />
      </mesh>
      <mesh position={[-11, 2.3, 0]} rotation={[0, Math.PI / 2, 0]} receiveShadow>
        <boxGeometry args={[18, 4.6, 0.2]} />
        <meshStandardMaterial color="#e7e9eb" roughness={0.95} />
      </mesh>
      <WindowFrame position={[-6.7, 0, -8.68]} />
      <WindowFrame position={[-1.8, 0, -8.68]} />
      <WindowFrame position={[-10.68, 0, -2.8]} rotation={Math.PI / 2} />

      <Plant position={[-8.6, 0, 4.6]} scale={1.3} />
      <Plant position={[8.4, 0, -4]} scale={0.9} />
      <Stool position={[5.8, 0, 3.2]} />
      <Stool position={[-5.8, 0, -4.2]} />
    </>
  )
}

function Workbench() {
  return (
    <group position={[0, 0, -0.3]}>
      <mesh position={[0, 0.82, 0]} castShadow receiveShadow>
        <boxGeometry args={[8.2, 0.34, 5.5]} />
        <meshStandardMaterial color="#f6f8f7" roughness={0.72} />
      </mesh>
      <mesh position={[0, 0.63, 0]}>
        <boxGeometry args={[7.9, 0.08, 5.2]} />
        <meshStandardMaterial color="#c8d4d4" roughness={0.75} />
      </mesh>
      {[-3.65, 3.65].flatMap((x) => [-2.25, 2.25].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, 0.34, z]}>
          <boxGeometry args={[0.18, 0.58, 0.18]} />
          <meshStandardMaterial color="#b6c2c3" metalness={0.25} roughness={0.6} />
        </mesh>
      )))}
      <mesh position={[0, 1.025, 0]} receiveShadow>
        <boxGeometry args={[6.5, 0.05, 3.9]} />
        <meshStandardMaterial color="#e7eeee" roughness={0.8} />
      </mesh>
    </group>
  )
}

function componentPositions(components: HardwareComponent[]) {
  if (!components.length) return new Map<string, Point>()
  const xs = components.map((part) => Number.isFinite(part.x) ? part.x : 0)
  const ys = components.map((part) => Number.isFinite(part.y) ? part.y : 0)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const span = Math.max(maxX - minX, maxY - minY, 1)
  const scale = 4.8 / span
  return new Map(components.map((part) => [
    part.id,
    [((part.x - (minX + maxX) / 2) * scale), 1.2, ((part.y - (minY + maxY) / 2) * scale)] as Point,
  ]))
}

function pinColor(color: string) {
  if (/^#[\da-f]{6}$/i.test(color)) return color
  const colors: Record<string, string> = { red: '#ef4444', black: '#20252a', green: '#22a06b', blue: '#3b82f6', yellow: '#eab308', orange: '#f97316' }
  return colors[color.toLowerCase()] ?? '#17a2a4'
}

function ProjectWires({ wires, positions }: { wires: HardwareWire[]; positions: Map<string, Point> }) {
  const paths = useMemo(() => wires.flatMap((wire) => {
    const start = positions.get(wire.from.component)
    const end = positions.get(wire.to.component)
    if (!start || !end) return []
    const points = [
      new THREE.Vector3(start[0], 1.33, start[2]),
      new THREE.Vector3((start[0] + end[0]) / 2, 1.58, (start[2] + end[2]) / 2),
      new THREE.Vector3(end[0], 1.33, end[2]),
    ]
    const curve = new THREE.QuadraticBezierCurve3(points[0], points[1], points[2])
    return [{ id: wire.id, geometry: new THREE.TubeGeometry(curve, 18, 0.025, 5, false), color: pinColor(wire.color) }]
  }), [positions, wires])
  useEffect(() => () => paths.forEach((path) => path.geometry.dispose()), [paths])

  return <>{paths.map((path) => <mesh key={path.id} geometry={path.geometry}><meshStandardMaterial color={path.color} roughness={0.42} /></mesh>)}</>
}

function ProjectPart({ component, kind, position, selected, onSelect, onOpen }: {
  component: HardwareComponent
  kind?: KindDefinition
  position: Point
  selected: boolean
  onSelect: (id: string) => void
  onOpen: (id: string) => void
}) {
  const status = renderStatus(kind)
  const group = kind?.group ?? 'unresolved'
  const board = group === 'board'
  const electromechanical = group === 'electromech'
  const passive = group === 'passive'
  const output = group === 'output'
  const sensor = group === 'sensor'
  const color = status === 'unrenderable' ? '#b76570'
    : selected ? '#e8a637'
      : board ? '#2863a2'
        : electromechanical ? '#687783'
          : passive ? '#d4b57b'
            : output ? '#d9aa43'
              : sensor ? '#e3e4de' : '#c8d4d2'
  const shape = output && kind?.id.includes('led') ? 'sphere'
    : ['sensor', 'passive', 'electromech', 'source', 'storage'].includes(group) ? 'cylinder' : 'box'
  const ports = kind?.ports ?? []
  const dimensions: Point = board ? [0.8, 0.14, 0.58]
    : electromechanical ? [0.4, 0.34, 0.4]
      : passive ? [0.14, 0.25, 0.14]
        : [0.36, 0.24, 0.3]

  return (
    <group
      position={position}
      onClick={(event) => { event.stopPropagation(); onSelect(component.id) }}
      onDoubleClick={(event) => { event.stopPropagation(); onOpen(component.id) }}
    >
      <mesh position={[0, selected ? 0.12 : 0, 0]} castShadow>
        {shape === 'sphere' ? <sphereGeometry args={[0.14, 16, 12]} /> : shape === 'cylinder' ? <cylinderGeometry args={[dimensions[0] / 2, dimensions[0] / 2, dimensions[1], 20]} /> : <boxGeometry args={dimensions} />}
        <meshStandardMaterial color={color} roughness={0.52} metalness={board || electromechanical ? 0.28 : 0.08} emissive={selected ? '#b45309' : '#000000'} emissiveIntensity={selected ? 0.24 : 0} />
      </mesh>
      {board && [-0.3, -0.2, -0.1, 0, 0.1, 0.2, 0.3].flatMap((x) => [-0.25, 0.25].map((z) => (
        <mesh key={`${x}-${z}`} position={[x, -0.09, z]}>
          <cylinderGeometry args={[0.018, 0.018, 0.05, 6]} />
          <meshStandardMaterial color="#d5b56f" metalness={0.55} />
        </mesh>
      )))}
      {sensor && [-0.12, 0.12].map((x) => (
        <mesh key={x} position={[x, 0.02, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.075, 0.075, 0.05, 16]} />
          <meshStandardMaterial color="#65737b" metalness={0.5} roughness={0.25} />
        </mesh>
      ))}
      {electromechanical && <mesh position={[0, 0.27, 0]}><cylinderGeometry args={[0.055, 0.055, 0.25, 12]} /><meshStandardMaterial color="#b7c1c4" metalness={0.6} /></mesh>}
      {kind && ports.slice(0, Math.min(ports.length, 12)).map((port, index) => {
        const angle = (index / Math.min(ports.length, 12)) * Math.PI * 2
        return (
          <mesh key={port.name} position={[Math.cos(angle) * 0.32, 0.1, Math.sin(angle) * 0.24]}>
            <sphereGeometry args={[0.035, 8, 6]} />
            <meshStandardMaterial color={port.direction === 'out' ? '#26a982' : port.direction === 'in' ? '#4f8ed6' : '#bd8c3d'} />
          </mesh>
        )
      })}
      {!kind && (
        <mesh position={[0.13, 0.17, 0]}>
          <sphereGeometry args={[0.09, 12, 8]} />
          <meshStandardMaterial color="#fff4e8" />
        </mesh>
      )}
    </group>
  )
}

function RoomScene({ project, selectedId, onSelect, onOpen, preset, zoom }: {
  project: HardwareProject | null
  selectedId: string | null
  onSelect: (id: string) => void
  onOpen: (id: string) => void
  preset: CameraPreset
  zoom: number
}) {
  const positions = useMemo(() => componentPositions(project?.components ?? []), [project?.components])
  const resolvedComponents = useMemo(
    () => (project?.components ?? []).map((component) => ({ component, kind: resolveKind(component.type) })),
    [project?.components],
  )

  return (
    <>
      <RoomShellGeometry />
      <Workbench />
      {project && <ProjectWires wires={project.wires} positions={positions} />}
      {resolvedComponents.map(({ component, kind }) => {
        const position = positions.get(component.id)
        return position ? <ProjectPart key={component.id} component={component} kind={kind} position={position} selected={selectedId === component.id} onSelect={onSelect} onOpen={onOpen} /> : null
      })}
      <RoomCamera preset={preset} zoom={zoom} />
    </>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-200 py-2.5 last:border-0">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-right font-mono text-[13px] font-medium text-slate-700">{value}{detail && <small className="ml-1 text-[11px] font-normal text-slate-400">{detail}</small>}</span>
    </div>
  )
}

export function RoomShell() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const [loadedProject, setLoadedProject] = useState<{ id: string; value: HardwareProject | null; error: string }>({
    id: '',
    value: null,
    error: '',
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [preset, setPreset] = useState<CameraPreset>('fit')
  const [zoom, setZoom] = useState(1)
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth)

  useEffect(() => {
    const updateWidth = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [])

  useEffect(() => {
    if (!projectId) return
    let active = true
    hardwareApi.getProject(projectId)
      .then((next) => {
        if (!active) return
        setLoadedProject({ id: projectId, value: next, error: '' })
        setSelectedId(next.components[0]?.id ?? null)
      })
      .catch((error: unknown) => {
        if (!active) return
        setLoadedProject({
          id: projectId,
          value: null,
          error: error instanceof Error ? error.message : 'Could not load this project.',
        })
      })
    return () => { active = false }
  }, [projectId])

  const project = loadedProject.id === projectId ? loadedProject.value : null
  const loadError = loadedProject.id === projectId ? loadedProject.error : ''
  const selectedPart = project?.components.find((component) => component.id === selectedId) ?? null
  const focusedPart = project?.components.find((component) => component.id === focusedId) ?? null
  const componentDescriptors = useMemo(
    () => (project?.components ?? []).map((component) => {
      const kind = resolveKind(component.type)
      return { component, kind, status: renderStatus(kind) }
    }),
    [project?.components],
  )
  const unrenderableParts = componentDescriptors.filter(({ status }) => status === 'unrenderable')
  const selectedKind = selectedPart ? resolveKind(selectedPart.type) : undefined
  const selectedStatus = renderStatus(selectedKind)
  const focusedKind = focusedPart ? resolveKind(focusedPart.type) : undefined
  const focusedStatus = renderStatus(focusedKind)
  const focusedCapability = focusedKind ? capabilitiesById.get(focusedKind.id) : undefined
  const focusedMechanicsDeclared = capabilityDocument.generator_status === 'generated' &&
    focusedCapability?.simulated === true && focusedCapability.solver === 'mechanics'
  const boardCapability = project
    ? capabilitiesById.get(`board.${project.board}`)
    : undefined
  const compilerStatus = project?.compiler?.status ?? 'not compiled'
  const boardStatus = compilerStatus === 'simulation_ready' || compilerStatus === 'compilation_complete'
    ? 'Compile result saved'
    : compilerStatus === 'not compiled' ? 'Not compiled' : compilerStatus.replaceAll('_', ' ')

  const openWorkspace = () => {
    if (projectId) navigate(`/project/${projectId}`)
    else navigate('/projects')
  }

  const setZoomBy = (amount: number) => setZoom((current) => Math.min(1.45, Math.max(0.65, current + amount)))
  const openFocusedPart = (id: string) => {
    setSelectedId(id)
    setFocusedId(id)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && focusedId) {
        setFocusedId(null)
      } else if (event.key === 'Enter' && selectedPart && !focusedId) {
        openFocusedPart(selectedPart.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusedId, selectedPart])

  return (
    <main className="relative h-svh min-h-[560px] overflow-hidden bg-[#e7ecee] text-slate-800">
      <header style={{ zIndex: 30 }} className="absolute inset-x-0 top-0 flex h-12 items-center gap-3 border-b border-slate-300 bg-white/95 px-3 shadow-sm backdrop-blur">
        <Link to="/" aria-label="WireUp home" className="flex size-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100">⌂</Link>
        <span className="text-lg text-slate-400">▦</span>
        <button type="button" onClick={openWorkspace} className="max-w-52 truncate border-x border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
          {project?.name ?? 'Room preview'} <span className="ml-1 text-slate-400">⌄</span>
        </button>
        <nav aria-label="Project steps" className="ml-2 hidden items-center gap-1 md:flex">
          <button type="button" onClick={openWorkspace} className="rounded-md px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"><b className="mr-2 rounded-full bg-slate-500 px-1.5 py-0.5 text-white">1</b>Build</button>
          <button type="button" onClick={openWorkspace} className="rounded-md px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"><b className="mr-2 rounded-full bg-slate-500 px-1.5 py-0.5 text-white">2</b>Wire</button>
          <button type="button" onClick={openWorkspace} className="rounded-md px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-100"><b className="mr-2 rounded-full bg-slate-500 px-1.5 py-0.5 text-white">3</b>Code</button>
          <button type="button" onClick={openWorkspace} className="rounded-md bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800"><span className="mr-1.5">↗</span>Open workspace</button>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={openWorkspace} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Open workspace</button>
          <button type="button" onClick={() => navigate('/')} className="rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">Home</button>
        </div>
      </header>

      <section style={{ inset: '48px 0 0', zIndex: 0 }} className="absolute">
        <Canvas fallback={<div role="status" className="flex h-full items-center justify-center bg-[#e7ecee] p-8 text-center text-sm text-slate-700">WebGL is unavailable in this browser. Open the 2D workspace instead; the rest of WireUp is unaffected.</div>} camera={{ position: cameraPositions.fit, fov: 42 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: 'low-power' }}>
          <RoomScene project={project} selectedId={selectedId} onSelect={setSelectedId} onOpen={openFocusedPart} preset={preset} zoom={zoom} />
        </Canvas>
      </section>

      <section style={{ left: 12, right: 12, top: 56, zIndex: 20 }} className="absolute flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200/90 bg-white/90 p-2.5 shadow-lg backdrop-blur sm:p-3">
        <div className="min-w-44">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <span>3D Project View</span><span className={`size-2 rounded-full ${project ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            <span className="max-w-44 truncate text-xs font-normal text-slate-500">{project ? `${project.board} · saved project view` : 'Room preview'}</span>
          </div>
          <button type="button" onClick={openWorkspace} className="mt-2 rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800">{projectId ? 'Back to the bench' : 'Choose a project'}</button>
        </div>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-1.5">
          <span className="mr-1 text-xs font-semibold text-slate-500">View</span>
          {(['iso', 'top', 'front', 'fit'] as const).map((view) => (
            <button key={view} type="button" onClick={() => setPreset(view)} className={`rounded-md border px-2.5 py-1.5 text-xs font-medium ${preset === view ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}`}>
              {view === 'iso' ? 'Iso' : view === 'top' ? 'Top' : view === 'front' ? 'Front' : 'Fit'}
            </button>
          ))}
          <button type="button" aria-label="Zoom out" onClick={() => setZoomBy(0.1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">−</button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoomBy(-0.1)} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm hover:bg-slate-50">+</button>
          {selectedPart && <button
            type="button"
            onClick={() => openFocusedPart(selectedPart.id)}
            className="rounded-md bg-teal-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-800"
          >
            Open {selectedKind?.label ?? selectedPart.type}
          </button>}
        </div>
      </section>

      {viewportWidth >= 768 && <aside style={{ left: 12, bottom: 12, zIndex: 20 }} className="absolute w-64 rounded-xl border border-slate-200 bg-white/95 p-3 shadow-xl backdrop-blur">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Project components</p>
        {project ? (
          project.components.length ? (
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
              {componentDescriptors.map(({ component, kind, status }) => (
                <li key={component.id}>
                  <button type="button" onClick={() => setSelectedId(component.id)} className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${selectedId === component.id ? 'bg-teal-50 text-teal-900' : 'text-slate-600 hover:bg-slate-50'}`}>
                    <span className="min-w-0">
                        <span className="block truncate font-medium">{kind?.label ?? component.type}</span>
                      <span className="block truncate text-[10px] text-slate-400">{component.id}</span>
                    </span>
                      <span className="shrink-0 text-[9px] font-semibold" style={{ color: statusColor(status) }}>
                        {status === 'declared_support_unverified' ? 'UNVERIFIED' : status === 'placement_only' ? 'PLACEMENT' : 'UNRENDERABLE'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-xs text-slate-500">This project has no components yet.</p>
        ) : <p className="mt-2 text-xs leading-5 text-slate-500">Select a project to see its components laid out on the bench.</p>}
        {unrenderableParts.length > 0 && (
          <div role="status" className="mt-3 rounded-md border border-rose-200 bg-rose-50 p-2 text-[11px] leading-4 text-rose-800">
            Unrenderable legacy kinds: {unrenderableParts.map(({ component }) => component.type).join(', ')}. These remain visible as unresolved placeholders.
          </div>
        )}
      </aside>}

      {viewportWidth >= 1280 && <aside style={{ top: 158, right: 12, bottom: 12, zIndex: 20, width: 288 }} className="absolute overflow-y-auto rounded-xl border border-slate-200 bg-white/95 p-4 shadow-xl backdrop-blur">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">Project status</p>
        <div className="mt-2">
          <Metric label="Board" value={project?.board ?? '—'} />
          <Metric label="Components" value={project ? String(project.components.length) : '—'} />
          <Metric label="Connections" value={project ? String(project.wires.length) : '—'} />
          <Metric label="Revision" value={project ? String(project.revision) : '—'} />
          <Metric label="Firmware" value={project ? boardStatus : '—'} />
          <Metric
            label="Declared solver"
            value={boardCapability?.solver ?? 'Unavailable'}
            detail={boardCapability?.simulated ? 'unverified' : 'not declared'}
          />
          <Metric label="Runtime results" value="Read when focused" />
        </div>
        <div className="mt-4 border-t border-slate-200 pt-3">
          <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500">{selectedPart ? 'Selected component' : 'About this view'}</h2>
          {selectedPart ? (
            <>
              <p className="mt-2 text-sm font-semibold text-slate-700">{selectedPart.id}</p>
              <p className="mt-1 text-xs text-slate-500">{selectedPart.type}</p>
              <p className="mt-2 text-xs font-semibold" style={{ color: statusColor(selectedStatus) }}>
                {statusLabel(selectedStatus)}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                {selectedKind
                  ? `Rendered as a ${selectedKind.group} primitive from the kind contract, not a verified CAD model. ${selectedKind.ports.length} contract ports; marker positions are illustrative.`
                  : 'No unambiguous contract kind matches this legacy component, so it is shown as an unresolved placeholder.'}
              </p>
              <p className="mt-2 text-xs leading-5 text-slate-500">The room does not start simulation. Open details to query an attached browser runtime; vehicle physics is not available unless the declared mechanics capability supports this part.</p>
            </>
          ) : (
            <ul className="mt-2 space-y-2 text-xs leading-5 text-slate-500">
              <li>Orbit with left-drag; pan with right-drag; scroll to zoom.</li>
              <li>Choose a component from the list or click it on the bench.</li>
              <li>Project status is read from saved project data; component details query live results only from an acknowledged browser runtime.</li>
              <li>The room does not start simulation. Use the hardware workspace to start the browser runtime.</li>
            </ul>
          )}
          {loadError && <p role="alert" className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-700">{loadError}</p>}
          {!projectId && <p className="mt-3 rounded-md bg-sky-50 p-2 text-xs leading-5 text-sky-800">Preview scene only. Open a project to display its actual components and saved wiring.</p>}
        </div>
      </aside>}

      {focusedPart && project && <RoomFocus
        project={project}
        component={focusedPart}
        kind={focusedKind}
        status={statusLabel(focusedStatus)}
        statusColor={statusColor(focusedStatus)}
        mechanicsDeclared={focusedMechanicsDeclared}
        onClose={() => setFocusedId(null)}
      />}

      {loadError && <p role="alert" style={{ left: 12, bottom: 12, zIndex: 30 }} className="absolute max-w-sm rounded-lg border border-red-200 bg-white p-3 text-sm text-red-700 shadow-lg">{loadError}</p>}
    </main>
  )
}

export default RoomShell
