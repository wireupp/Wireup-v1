import { formatIstDateTime, formatDuration, formatInr, formatNumber } from '@/lib/admin/format'
import { REQUEST_TYPE_LABELS } from '@/lib/admin/types'
import type { AiRequest } from '@/lib/admin/types'
import { useAdminStore } from '@/lib/admin/store'
import { Drawer, DrawerSection, KeyValue, RequestStatusBadge } from './ui'

/** Detail drawer for a single AI request. Prompt previews are synthetic; no
 *  real user content or credentials are ever shown. */
export function RequestDrawer({ request, onClose }: { request: AiRequest | null; onClose: () => void }) {
  const accounts = useAdminStore(state => state.accounts)
  const models = useAdminStore(state => state.models)
  if (!request) return null
  const account = accounts.find(item => item.id === request.accountId)
  const model = models.find(item => item.id === request.modelId)
  const netCharge = request.creditsCharged
  return (
    <Drawer open title={`Request ${request.id}`} sub={REQUEST_TYPE_LABELS[request.type]} onClose={onClose} footer={
      <button className="admin-btn" onClick={onClose}>Close</button>
    }>
      <DrawerSection title="Result">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <RequestStatusBadge status={request.status}/>
          {request.errorCategory && <span className="admin-badge admin-badge--red mono">{request.errorCategory}</span>}
          {request.retries > 0 && <span className="admin-badge admin-badge--amber">{request.retries} retry attempt{request.retries > 1 ? 's' : ''} (simulated)</span>}
        </div>
        <KeyValue rows={[
          ['Timestamp', formatIstDateTime(request.timestamp)],
          ['Duration', formatDuration(request.durationMs)],
          ['Error details', request.errorCategory ? `${request.errorCategory} — the request did not complete; credits reserved were released.` : 'None'],
        ]}/>
      </DrawerSection>

      <DrawerSection title="Account">
        <KeyValue rows={[
          ['Account', account ? account.name : request.accountId],
          ['Email', account?.email ?? '—'],
          ['User ID', <span className="mono">{request.accountId}</span>],
        ]}/>
      </DrawerSection>

      <DrawerSection title="Model & provider">
        <KeyValue rows={[
          ['Provider', model?.providerId === 'sarvam' ? 'Sarvam AI' : model?.providerId ?? request.providerId],
          ['Model', <span className="mono">{request.modelId}</span>],
          ['Simulated pricing', model ? `₹${model.inputPricePerMillion} in / ₹${model.outputPricePerMillion} out per 1M tokens (mock)` : '—'],
        ]}/>
      </DrawerSection>

      <DrawerSection title="Token usage">
        <KeyValue rows={[
          ['Input tokens', formatNumber(request.inputTokens)],
          ['Output tokens', formatNumber(request.outputTokens)],
          ['Total tokens', formatNumber(request.inputTokens + request.outputTokens)],
          ['Usage metadata', `type=${request.type} · retries=${request.retries} · cancelled=${request.status === 'cancelled'}`],
        ]}/>
      </DrawerSection>

      <DrawerSection title="Credit accounting">
        <KeyValue rows={[
          ['Credits reserved', formatNumber(request.creditsReserved)],
          ['Credits charged', formatNumber(request.creditsCharged)],
          ['Credits refunded', formatNumber(request.creditsRefunded)],
          ['Net charge', `${formatNumber(netCharge)} credits`],
          ['Estimated API cost', `${formatInr(request.estimatedCostInr)} (simulated pricing)`],
        ]}/>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--a-faint)' }}>
          Credits are platform units and are deliberately not treated as equivalent to tokens. Cost figures use mock provider pricing configured in Models &amp; Providers.
        </p>
      </DrawerSection>

      <DrawerSection title="Prompt preview (synthetic)">
        <div className="admin-code">{request.promptPreview}</div>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--a-faint)' }}>
          Prompt bodies are replaced with synthetic samples in demo mode. Production must keep prompt storage behind server-side access controls.
        </p>
      </DrawerSection>
    </Drawer>
  )
}
