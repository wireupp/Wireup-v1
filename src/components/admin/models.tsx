import { useMemo, useState } from 'react'
import { CircleCheck, CircleOff, Info, Plus } from 'lucide-react'
import { useAdminStore } from '@/lib/admin/store'
import type { ModelPatch } from '@/lib/admin/store'
import { formatCredits, formatInr, formatNumber } from '@/lib/admin/format'
import { breakdownBy } from '@/lib/admin/selectors'
import type { ModelConfig } from '@/lib/admin/types'
import { Badge, ConfirmDialog, Drawer, DrawerSection, EmptyState, KeyValue, Modal, Switch } from './ui'

export function ModelsPage() {
  const models = useAdminStore(state => state.models)
  const providers = useAdminStore(state => state.providers)
  const requests = useAdminStore(state => state.requests)
  const updateModel = useAdminStore(state => state.updateModel)
  const addModel = useAdminStore(state => state.addModel)
  const addProvider = useAdminStore(state => state.addProvider)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [providerDetail, setProviderDetail] = useState<string | null>(null)
  const [addModelOpen, setAddModelOpen] = useState(false)
  const [addProviderOpen, setAddProviderOpen] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState<ModelConfig | null>(null)
  const [newModel, setNewModel] = useState({ providerId: 'sarvam', displayName: '', inputPricePerMillion: '5', outputPricePerMillion: '15', creditMultiplier: '1', maxOutputTokens: '4096', maxCreditsPerRequest: '100' })
  const [newProviderName, setNewProviderName] = useState('')
  const [draft, setDraft] = useState({ displayName: '', inputPricePerMillion: '', outputPricePerMillion: '', creditMultiplier: '', maxOutputTokens: '', maxCreditsPerRequest: '' })

  const statsByModel = useMemo(() => {
    const rows = breakdownBy(requests, request => request.modelId, () => '')
    return new Map(rows.map(row => [row.id, row]))
  }, [requests])

  const editing = models.find(model => model.id === editingId) ?? null
  const openEdit = (model: ModelConfig) => {
    setDraft({
      displayName: model.displayName,
      inputPricePerMillion: String(model.inputPricePerMillion),
      outputPricePerMillion: String(model.outputPricePerMillion),
      creditMultiplier: String(model.creditMultiplier),
      maxOutputTokens: String(model.maxOutputTokens),
      maxCreditsPerRequest: String(model.maxCreditsPerRequest),
    })
    setEditingId(model.id)
  }

  const saveEdit = () => {
    if (!editing) return
    const patch: ModelPatch = {
      displayName: draft.displayName.trim() || editing.displayName,
      inputPricePerMillion: Number(draft.inputPricePerMillion) || 0,
      outputPricePerMillion: Number(draft.outputPricePerMillion) || 0,
      creditMultiplier: Number(draft.creditMultiplier) || 1,
      maxOutputTokens: Number(draft.maxOutputTokens) || editing.maxOutputTokens,
      maxCreditsPerRequest: Number(draft.maxCreditsPerRequest) || editing.maxCreditsPerRequest,
    }
    updateModel(editing.id, patch, 'Edited in Models & Providers')
    setEditingId(null)
  }

  const provider = providers.find(item => item.id === providerDetail) ?? null
  const providerModels = provider ? models.filter(model => model.providerId === provider.id) : []

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h2>Models & providers</h2>
          <p>Mock configuration for Sarvam AI and future providers. Model IDs and prices are examples until verified with the provider — no live API is called.</p>
        </div>
        <div className="admin-page-actions">
          <button className="admin-btn" onClick={() => setAddProviderOpen(true)}><Plus size={13}/>Add provider</button>
          <button className="admin-btn admin-btn--primary" onClick={() => setAddModelOpen(true)}><Plus size={13}/>Add model</button>
        </div>
      </div>

      <div className="admin-grid admin-grid--thirds">
        {providers.map(item => {
          const itemModels = models.filter(model => model.providerId === item.id)
          const enabled = itemModels.filter(model => model.enabled).length
          return (
            <button key={item.id} className="admin-stat" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setProviderDetail(item.id)}>
              <span className="admin-stat__label">
                {item.status === 'connected' ? <CircleCheck size={13} color="var(--a-green)"/> : <CircleOff size={13} color="var(--a-faint)"/>}
                {item.name}
              </span>
              <span className="admin-stat__value" style={{ fontSize: 16 }}>{itemModels.length} models</span>
              <span className="admin-stat__foot">{enabled} enabled · status: {item.status} (simulated)</span>
            </button>
          )
        })}
      </div>

      <div className="admin-card">
        <div className="admin-card__header">
          <span className="admin-card__title">Models</span>
          <span className="admin-card__hint">usage columns derive from the demo request log · pricing is mock configuration</span>
        </div>
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Model</th><th>Provider</th><th>Status</th>
                <th className="num">Requests</th><th className="num">Input tok</th><th className="num">Output tok</th>
                <th className="num">Credits</th><th className="num">Est. cost</th><th className="num">Avg latency</th><th className="num">Error rate</th>
                <th className="num">₹/1M in</th><th className="num">₹/1M out</th><th className="num">Multiplier</th>
                <th/>
              </tr>
            </thead>
            <tbody>
              {models.map(model => {
                const stats = statsByModel.get(model.id)
                const requestCount = stats?.requests ?? 0
                const errorRate = requestCount > 0 ? ((stats?.errors ?? 0) / requestCount) * 100 : 0
                return (
                  <tr key={model.id} style={{ cursor: 'pointer' }} onClick={() => openEdit(model)}>
                    <td><span className="admin-table__primary">{model.displayName}</span><div className="admin-table__sub mono">{model.id}</div></td>
                    <td>{providers.find(item => item.id === model.providerId)?.name ?? model.providerId}</td>
                    <td><Badge tone={model.enabled ? 'admin-badge--green' : 'admin-badge--gray'}>{model.enabled ? 'Enabled' : 'Disabled'}</Badge></td>
                    <td className="num">{formatNumber(requestCount)}</td>
                    <td className="num">{formatNumber(stats?.inputTokens ?? 0)}</td>
                    <td className="num">{formatNumber(stats?.outputTokens ?? 0)}</td>
                    <td className="num">{formatCredits(stats?.credits ?? 0)}</td>
                    <td className="num">{formatInr(stats?.costInr ?? 0)}</td>
                    <td className="num">—</td>
                    <td className="num">{errorRate.toFixed(1)}%</td>
                    <td className="num">{model.inputPricePerMillion}</td>
                    <td className="num">{model.outputPricePerMillion}</td>
                    <td className="num">×{model.creditMultiplier}</td>
                    <td onClick={event => event.stopPropagation()}>
                      <button className={`admin-btn admin-btn--sm${model.enabled ? '' : ' admin-btn--primary'}`} onClick={() => {
                        if (model.enabled) setConfirmDisable(model)
                        else updateModel(model.id, { enabled: true }, 'Enabled from Models & Providers')
                      }}>{model.enabled ? 'Disable' : 'Enable'}</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Drawer open={Boolean(editing)} title={editing?.displayName ?? ''} sub={`${editing?.id ?? ''} · mock configuration`} onClose={() => setEditingId(null)} footer={
        <>
          <button className="admin-btn" onClick={() => setEditingId(null)}>Cancel</button>
          <button className="admin-btn admin-btn--primary" onClick={saveEdit}>Save configuration</button>
        </>
      }>
        {editing && (
          <>
            <DrawerSection title="Identity & availability">
              <label className="admin-field"><span className="admin-field__label">Display name</span>
                <input className="admin-input" value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })}/></label>
              <label className="admin-check">
                <Switch checked={editing.enabled} onChange={value => {
                  if (!value) setConfirmDisable(editing)
                  else updateModel(editing.id, { enabled: true }, 'Enabled from model drawer')
                }} label="Enabled for new requests"/>
                <span>Enabled for new requests (availability is simulated — no backend enforces this yet)</span>
              </label>
            </DrawerSection>
            <DrawerSection title="Simulated pricing (INR per 1M tokens)">
              <div className="admin-inline-fields">
                <label className="admin-field"><span className="admin-field__label">Input price ₹</span>
                  <input className="admin-input" type="number" min={0} step="0.5" value={draft.inputPricePerMillion} onChange={event => setDraft({ ...draft, inputPricePerMillion: event.target.value })}/></label>
                <label className="admin-field"><span className="admin-field__label">Output price ₹</span>
                  <input className="admin-input" type="number" min={0} step="0.5" value={draft.outputPricePerMillion} onChange={event => setDraft({ ...draft, outputPricePerMillion: event.target.value })}/></label>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: 'var(--a-faint)' }}>Changing prices updates future simulated cost calculations across the console. Historical request records keep their original estimates.</p>
            </DrawerSection>
            <DrawerSection title="Credit rules & caps">
              <div className="admin-inline-fields">
                <label className="admin-field"><span className="admin-field__label">Credit multiplier</span>
                  <input className="admin-input" type="number" min={0} step="0.1" value={draft.creditMultiplier} onChange={event => setDraft({ ...draft, creditMultiplier: event.target.value })}/></label>
                <label className="admin-field"><span className="admin-field__label">Max output tokens</span>
                  <input className="admin-input" type="number" min={1} value={draft.maxOutputTokens} onChange={event => setDraft({ ...draft, maxOutputTokens: event.target.value })}/></label>
                <label className="admin-field"><span className="admin-field__label">Max credits / request</span>
                  <input className="admin-input" type="number" min={1} value={draft.maxCreditsPerRequest} onChange={event => setDraft({ ...draft, maxCreditsPerRequest: event.target.value })}/></label>
              </div>
            </DrawerSection>
            <DrawerSection title="Notes">
              <p style={{ margin: 0, fontSize: 12, color: 'var(--a-muted)' }}>{editing.description}</p>
            </DrawerSection>
          </>
        )}
      </Drawer>

      <Drawer open={Boolean(provider)} title={provider?.name ?? ''} sub={`provider · ${provider?.status ?? ''} (simulated)`} onClose={() => setProviderDetail(null)} footer={
        <button className="admin-btn" onClick={() => setProviderDetail(null)}>Close</button>
      }>
        {provider && (
          <>
            <DrawerSection title="Provider">
              <KeyValue rows={[
                ['Provider ID', <span className="mono">{provider.id}</span>],
                ['Status', provider.status === 'connected' ? 'Connected (mock)' : 'Planned'],
                ['Website', provider.website || '—'],
              ]}/>
            </DrawerSection>
            <DrawerSection title="Models on this provider">
              {providerModels.length === 0 ? <p style={{ margin: 0, color: 'var(--a-faint)', fontSize: 12 }}>No models configured yet.</p> : (
                <div className="admin-table-wrap">
                  <table className="admin-table admin-table--compact">
                    <thead><tr><th>Model</th><th>Status</th><th className="num">Requests</th></tr></thead>
                    <tbody>
                      {providerModels.map(model => (
                        <tr key={model.id} style={{ cursor: 'pointer' }} onClick={() => { setProviderDetail(null); openEdit(model) }}>
                          <td>{model.displayName}</td>
                          <td><Badge tone={model.enabled ? 'admin-badge--green' : 'admin-badge--gray'}>{model.enabled ? 'Enabled' : 'Disabled'}</Badge></td>
                          <td className="num">{formatNumber(statsByModel.get(model.id)?.requests ?? 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </DrawerSection>
            <DrawerSection title="Note">
              <p style={{ margin: 0, fontSize: 12, color: 'var(--a-muted)' }}>{provider.note}</p>
            </DrawerSection>
          </>
        )}
      </Drawer>

      <Modal open={addModelOpen} title="Add model (simulated)" onClose={() => setAddModelOpen(false)} footer={
        <>
          <button className="admin-btn" onClick={() => setAddModelOpen(false)}>Cancel</button>
          <button className="admin-btn admin-btn--primary" onClick={() => {
            addModel({
              providerId: newModel.providerId,
              displayName: newModel.displayName.trim(),
              inputPricePerMillion: Number(newModel.inputPricePerMillion) || 0,
              outputPricePerMillion: Number(newModel.outputPricePerMillion) || 0,
              creditMultiplier: Number(newModel.creditMultiplier) || 1,
              maxOutputTokens: Number(newModel.maxOutputTokens) || 4096,
              maxCreditsPerRequest: Number(newModel.maxCreditsPerRequest) || 100,
            })
            setAddModelOpen(false)
            setNewModel({ ...newModel, displayName: '' })
          }} disabled={!newModel.displayName.trim()}>Add model</button>
        </>}>
        <div className="admin-inline-fields">
          <label className="admin-field"><span className="admin-field__label">Provider</span>
            <select className="admin-select" value={newModel.providerId} onChange={event => setNewModel({ ...newModel, providerId: event.target.value })}>
              {providers.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></label>
          <label className="admin-field"><span className="admin-field__label">Display name</span>
            <input className="admin-input" value={newModel.displayName} onChange={event => setNewModel({ ...newModel, displayName: event.target.value })} placeholder="e.g. Sarvam-M Preview 2"/></label>
        </div>
        <div className="admin-inline-fields">
          <label className="admin-field"><span className="admin-field__label">Input ₹ / 1M</span>
            <input className="admin-input" type="number" min={0} value={newModel.inputPricePerMillion} onChange={event => setNewModel({ ...newModel, inputPricePerMillion: event.target.value })}/></label>
          <label className="admin-field"><span className="admin-field__label">Output ₹ / 1M</span>
            <input className="admin-input" type="number" min={0} value={newModel.outputPricePerMillion} onChange={event => setNewModel({ ...newModel, outputPricePerMillion: event.target.value })}/></label>
          <label className="admin-field"><span className="admin-field__label">Multiplier</span>
            <input className="admin-input" type="number" min={0} step="0.1" value={newModel.creditMultiplier} onChange={event => setNewModel({ ...newModel, creditMultiplier: event.target.value })}/></label>
        </div>
        <div className="admin-inline-fields">
          <label className="admin-field"><span className="admin-field__label">Max output tokens</span>
            <input className="admin-input" type="number" min={1} value={newModel.maxOutputTokens} onChange={event => setNewModel({ ...newModel, maxOutputTokens: event.target.value })}/></label>
          <label className="admin-field"><span className="admin-field__label">Max credits / request</span>
            <input className="admin-input" type="number" min={1} value={newModel.maxCreditsPerRequest} onChange={event => setNewModel({ ...newModel, maxCreditsPerRequest: event.target.value })}/></label>
        </div>
        <div className="admin-note"><Info size={13}/><span>New models start <strong>disabled</strong>. The model ID is generated from the display name — treat it as a placeholder until verified with the provider.</span></div>
      </Modal>

      <Modal open={addProviderOpen} title="Add provider (simulated)" onClose={() => setAddProviderOpen(false)} footer={
        <>
          <button className="admin-btn" onClick={() => setAddProviderOpen(false)}>Cancel</button>
          <button className="admin-btn admin-btn--primary" disabled={!newProviderName.trim()} onClick={() => { addProvider(newProviderName.trim()); setNewProviderName(''); setAddProviderOpen(false) }}>Add provider</button>
        </>}>
        <label className="admin-field">
          <span className="admin-field__label">Provider name</span>
          <input className="admin-input" value={newProviderName} onChange={event => setNewProviderName(event.target.value)} placeholder="e.g. Azure AI Foundry" autoFocus/>
        </label>
        <p style={{ margin: 0 }}>New providers are listed as <strong>planned</strong> with no connectivity. Integrating a real provider requires backend work (key vault, server-side routing, cost tracking).</p>
      </Modal>

      <ConfirmDialog open={Boolean(confirmDisable)} title={`Disable ${confirmDisable?.displayName ?? ''}?`}
        body={<>Requests routed to this model will stop in the simulated router. Existing records are unaffected. Accounts using it by default would fail over to another enabled model once the backend router exists.</>}
        confirmLabel="Disable model" tone="danger"
        onClose={() => setConfirmDisable(null)}
        onConfirm={() => { if (confirmDisable) updateModel(confirmDisable.id, { enabled: false }, 'Disabled from Models & Providers') }}/>

      {models.length === 0 && <EmptyState title="No models configured"/>}
    </div>
  )
}
