import { useEffect, useState } from 'react'
import { HardwareApiError, hardwareApi } from '@/lib/hardware'
import type { HardwareComponent, HardwareProject } from '@/lib/hardware'

type RuntimePin = { level: boolean | null; drive: string }
type RuntimeSnapshot = {
  running: boolean
  engine: string
  artifact_id: string | null
  cycles: number
  simulated_ms: number
  clock_hz: number
  pins: Record<string, RuntimePin>
  limitations: string[]
  support_warnings: string[]
  dropped_samples: number
}
type RuntimeReadState =
  | { projectId: string; status: 'loading' }
  | { projectId: string; status: 'connected'; snapshot: RuntimeSnapshot }
  | { projectId: string; status: 'unavailable' | 'error'; message: string }
type RoomFocusProps = {
  project: HardwareProject
  component: HardwareComponent
  kind?: { label: string; ports: { name: string }[] }
  status: string
  statusColor: string
  mechanicsDeclared: boolean
  onClose: () => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseRuntimeSnapshot(value: unknown): RuntimeSnapshot {
  if (!isRecord(value) || value.status !== 'acknowledged' || !isRecord(value.result)) {
    throw new Error('The browser runtime returned an invalid results response.')
  }
  const result = value.result
  if (
    typeof result.running !== 'boolean' ||
    typeof result.engine !== 'string' ||
    !(typeof result.artifact_id === 'string' || result.artifact_id === null) ||
    typeof result.cycles !== 'number' || !Number.isFinite(result.cycles) ||
    typeof result.simulated_ms !== 'number' || !Number.isFinite(result.simulated_ms) ||
    typeof result.clock_hz !== 'number' || !Number.isFinite(result.clock_hz) ||
    !isRecord(result.pins) ||
    !Array.isArray(result.limitations) || !result.limitations.every((item) => typeof item === 'string')
  ) {
    throw new Error('The browser runtime returned incomplete results.')
  }

  const pins: Record<string, RuntimePin> = {}
  for (const [name, pin] of Object.entries(result.pins)) {
    if (
      !isRecord(pin) ||
      !(typeof pin.level === 'boolean' || pin.level === null) ||
      typeof pin.drive !== 'string'
    ) {
      throw new Error(`The browser runtime returned an invalid state for pin ${name}.`)
    }
    pins[name] = { level: pin.level, drive: pin.drive }
  }

  const supportWarnings = result.support_warnings ?? []
  if (!Array.isArray(supportWarnings) || !supportWarnings.every((item) => typeof item === 'string')) {
    throw new Error('The browser runtime returned invalid support warnings.')
  }
  const droppedSamples = result.dropped_samples ?? 0
  if (typeof droppedSamples !== 'number' || !Number.isFinite(droppedSamples)) {
    throw new Error('The browser runtime returned an invalid dropped-sample count.')
  }

  return {
    running: result.running,
    engine: result.engine,
    artifact_id: result.artifact_id,
    cycles: result.cycles,
    simulated_ms: result.simulated_ms,
    clock_hz: result.clock_hz,
    pins,
    limitations: result.limitations,
    support_warnings: supportWarnings,
    dropped_samples: droppedSamples,
  }
}

function Metric({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-100 py-2 last:border-0">
      <span className="text-xs text-slate-500">{label}</span>
      <span className="text-right font-mono text-xs font-medium text-slate-700">
        {value}{detail && <small className="ml-1 text-[10px] font-normal text-slate-400">{detail}</small>}
      </span>
    </div>
  )
}

export function RoomFocus({ project, component, kind, status, statusColor, mechanicsDeclared, onClose }: RoomFocusProps) {
  const [runtimeRead, setRuntimeRead] = useState<RuntimeReadState | null>(null)

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let request: AbortController | undefined
    setRuntimeRead((current) => current?.projectId === project.id ? current : { projectId: project.id, status: 'loading' })
    const refresh = async () => {
      request = new AbortController()
      try {
        const response = await hardwareApi.command<unknown>(
          project,
          'read_simulation_results',
          {},
          { signal: request.signal },
        )
        const snapshot = parseRuntimeSnapshot(response)
        if (active) setRuntimeRead({ projectId: project.id, status: 'connected', snapshot })
      } catch (error) {
        if (!active || request.signal.aborted) return
        const unavailable = error instanceof HardwareApiError && error.status === 503
        setRuntimeRead({
          projectId: project.id,
          status: unavailable ? 'unavailable' : 'error',
          message: error instanceof Error ? error.message : 'Could not read browser runtime results.',
        })
      } finally {
        if (active) timer = setTimeout(() => void refresh(), 1000)
      }
    }

    void refresh()
    return () => {
      active = false
      if (timer) clearTimeout(timer)
      request?.abort()
    }
  }, [component, project])

  const connectedWires = project.wires.filter((wire) => wire.from.component === component.id || wire.to.component === component.id)

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-labelledby="room-focus-title"
      style={{ inset: 12, zIndex: 40 }}
      className="absolute overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/98 p-4 shadow-2xl backdrop-blur sm:p-6"
    >
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-700">Focused workspace · room state preserved</p>
            <h1 id="room-focus-title" className="mt-1 text-xl font-semibold text-slate-900">
              {kind?.label ?? component.type}
            </h1>
            <p className="mt-1 break-all font-mono text-xs text-slate-500">{component.id}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100"
          >
            ← Back to room
          </button>
        </header>

        <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="text-sm font-semibold text-slate-900">Component and connections</h2>
            <p className="mt-2 text-xs font-semibold" style={{ color: statusColor }}>{status}</p>
            <p className="mt-2 text-xs leading-5 text-slate-600">
              {kind
                ? `${kind.ports.length} contract ports. The room geometry is a group primitive, not a verified CAD model.`
                : 'This legacy component has no unambiguous kind contract; its geometry and behavior are unresolved.'}
            </p>
            <div className="mt-3">
              <Metric label="Project revision" value={String(project.revision)} />
              <Metric label="Saved position" value={`${component.x}, ${component.y}`} detail="workspace units" />
              <Metric label="Rotation" value={`${component.rotation}°`} />
              <Metric label="Connected wires" value={String(connectedWires.length)} />
            </div>
            {connectedWires.length > 0 && (
              <ul className="mt-3 space-y-2 border-t border-slate-100 pt-3">
                {connectedWires.map((wire) => {
                  const endpoint = wire.from.component === component.id ? wire.from : wire.to
                  const peer = wire.from.component === component.id ? wire.to : wire.from
                  const peerPart = project.components.find((part) => part.id === peer.component)
                  return <li key={wire.id} className="text-xs text-slate-600">
                    <span className="font-mono">{endpoint.pin}</span>
                    {' ↔ '}
                    <span>{peerPart?.type ?? 'unresolved component'}</span>
                    <span className="font-mono">:{peer.pin}</span>
                  </li>
                })}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Controller and electronics runtime</h2>
                <p className="mt-1 text-xs text-slate-500">Acknowledged snapshots from the existing browser emulator; refreshes once per second while this page is open.</p>
              </div>
              <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                runtimeRead?.projectId === project.id && runtimeRead.status === 'connected'
                  ? 'bg-emerald-100 text-emerald-800'
                  : runtimeRead?.projectId === project.id && runtimeRead.status === 'error'
                    ? 'bg-rose-100 text-rose-800'
                    : 'bg-amber-100 text-amber-800'
              }`}>
                {runtimeRead?.projectId !== project.id || runtimeRead?.status === 'loading'
                  ? 'Connecting'
                  : runtimeRead.status === 'connected'
                    ? runtimeRead.snapshot.running ? 'Running' : 'Connected · idle'
                    : runtimeRead.status === 'unavailable' ? 'Unavailable' : 'Read error'}
              </span>
            </div>

            {runtimeRead?.projectId === project.id && runtimeRead.status === 'connected' ? (
              <>
                <p className="mt-3 break-all text-xs text-slate-500">{runtimeRead.snapshot.engine}</p>
                {runtimeRead.snapshot.artifact_id ? (
                  <>
                    <div className="mt-2 grid gap-x-6 sm:grid-cols-2">
                      <Metric label="CPU cycles" value={runtimeRead.snapshot.cycles.toLocaleString()} detail="measured" />
                      <Metric label="Clock" value={runtimeRead.snapshot.clock_hz > 0 ? runtimeRead.snapshot.clock_hz.toLocaleString() : '—'} detail={runtimeRead.snapshot.clock_hz > 0 ? 'Hz · measured' : 'unavailable'} />
                      <Metric
                        label="Simulated time"
                        value={runtimeRead.snapshot.clock_hz > 0 ? `${(runtimeRead.snapshot.cycles / runtimeRead.snapshot.clock_hz).toFixed(3)} s` : '—'}
                        detail={runtimeRead.snapshot.clock_hz > 0 ? 'derived' : 'unavailable'}
                      />
                      <Metric label="Dropped edge samples" value={runtimeRead.snapshot.dropped_samples.toLocaleString()} />
                      <Metric label="Compiled artifact" value={runtimeRead.snapshot.artifact_id} />
                    </div>
                    <div className="mt-4 border-t border-slate-100 pt-3">
                      <h3 className="text-xs font-semibold text-slate-700">Last run pin states · measured</h3>
                      {Object.keys(runtimeRead.snapshot.pins).length ? (
                        <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                          {Object.entries(runtimeRead.snapshot.pins).sort(([left], [right]) => left.localeCompare(right)).map(([pin, state]) => (
                            <li key={pin} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2.5 py-2 text-xs">
                              <span className="font-mono text-slate-700">{pin}</span>
                              <span className="text-right text-slate-600">
                                {state.level === null ? 'Unknown' : state.level ? 'High' : 'Low'}
                                <span className="ml-1 text-[10px] text-slate-400">({state.drive})</span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : <p className="mt-2 text-xs text-slate-500">The runtime has not observed any project pins.</p>}
                    </div>
                  </>
                ) : (
                  <p className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                    The runtime is connected but no compiled artifact has run. There are no run measurements to show yet.
                  </p>
                )}
                {(runtimeRead.snapshot.support_warnings.length > 0 || runtimeRead.snapshot.limitations.length > 0) && (
                  <details className="mt-4 border-t border-slate-100 pt-3">
                    <summary className="cursor-pointer text-xs font-semibold text-slate-700">Runtime limitations and warnings</summary>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-slate-600">
                      {[...runtimeRead.snapshot.support_warnings, ...runtimeRead.snapshot.limitations].map((message, index) => <li key={`${index}-${message}`}>{message}</li>)}
                    </ul>
                  </details>
                )}
              </>
            ) : (
              <p className={`mt-3 rounded-lg p-3 text-xs leading-5 ${
                runtimeRead?.projectId === project.id && runtimeRead.status === 'error'
                  ? 'bg-rose-50 text-rose-800'
                  : 'bg-amber-50 text-amber-900'
              }`}>
                {runtimeRead?.projectId === project.id && (runtimeRead.status === 'error' || runtimeRead.status === 'unavailable')
                  ? runtimeRead.message
                  : 'Checking for an attached browser runtime. Start the existing simulation in the hardware workspace to expose its live electronics results here.'}
              </p>
            )}

            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-900">
              <strong>Vehicle dynamics are not measured in this view.</strong>{' '}
              {mechanicsDeclared
                ? 'Mechanics support is declared for this component, but the connected browser runtime only returned controller/electronics results; no mechanics telemetry was returned.'
                : 'No generated mechanics capability is declared for this component kind.'}{' '}
              The controller values above are not vehicle speed, motor RPM, torque, or acceleration.
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}
