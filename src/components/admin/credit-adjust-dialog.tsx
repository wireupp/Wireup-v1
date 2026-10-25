import { useEffect, useMemo, useState } from 'react'
import { useAdminStore } from '@/lib/admin/store'
import { formatCredits } from '@/lib/admin/format'
import { Modal } from './ui'
import type { Account } from '@/lib/admin/types'

export type CreditAdjustMode = 'grant' | 'deduct' | 'promotional'

/** Credit grant / deduction dialog with a before-and-after balance preview.
 *  Works for a single account or a bulk selection. */
export function CreditAdjustDialog({ open, accounts, mode, onClose }: {
  open: boolean
  accounts: Account[]
  mode: CreditAdjustMode
  onClose: () => void
}) {
  const adjustCredits = useAdminStore(state => state.adjustCredits)
  const pushToast = useAdminStore(state => state.pushToast)
  const promoValidityDays = useAdminStore(state => state.settings.resetPolicies.promoValidityDays)
  const [amount, setAmount] = useState('100')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) { setAmount('100'); setReason(''); setError('') }
  }, [open])

  const amountNumber = Number(amount)
  const valid = Number.isFinite(amountNumber) && amountNumber > 0 && Number.isInteger(amountNumber)
  const bulk = accounts.length > 1

  const preview = useMemo(() => {
    if (!valid) return null
    const totalBefore = accounts.reduce((sum, account) => sum + account.balances.daily + account.balances.permanent + account.balances.promotional, 0)
    let totalAfter = totalBefore
    let shortfalls = 0
    for (const account of accounts) {
      if (mode === 'deduct' && account.balances.daily + account.balances.permanent + account.balances.promotional < amountNumber) shortfalls += 1
      totalAfter += mode === 'deduct' ? -amountNumber : amountNumber
    }
    return { totalBefore, totalAfter, shortfalls }
  }, [accounts, amountNumber, valid, mode])

  const title = mode === 'grant' ? 'Grant permanent credits' : mode === 'promotional' ? 'Grant promotional credits' : 'Deduct credits'

  const submit = () => {
    if (!valid) { setError('Enter a positive whole number of credits.'); return }
    let failed = 0
    for (const account of accounts) {
      const ok = adjustCredits(account.id, { mode, amount: amountNumber, reason: reason.trim() || (bulk ? `Bulk ${mode} for ${accounts.length} accounts` : '') })
      if (!ok) failed += 1
    }
    if (failed > 0) pushToast({ title: `${failed} account${failed > 1 ? 's' : ''} skipped`, tone: 'error', description: 'Insufficient balance for the requested deduction.' })
    onClose()
  }

  return (
    <Modal open={open} title={title} onClose={onClose} footer={<>
      <button className="admin-btn" onClick={onClose}>Cancel</button>
      <button className={`admin-btn ${mode === 'deduct' ? 'admin-btn--danger' : 'admin-btn--primary'}`} onClick={submit} disabled={!valid || Boolean(preview?.shortfalls)}>
        {mode === 'deduct' ? 'Deduct credits' : 'Grant credits'}
      </button>
    </>}>
      <p>{bulk
        ? `Applies to ${accounts.length} selected accounts: ${accounts.slice(0, 3).map(account => account.name).join(', ')}${accounts.length > 3 ? ` and ${accounts.length - 3} more` : ''}.`
        : `${accounts[0]?.name} (${accounts[0]?.email})`}</p>
      <label className="admin-field">
        <span className="admin-field__label">Amount (credits)</span>
        <input className="admin-input" type="number" min={1} step={1} value={amount} onChange={event => { setAmount(event.target.value); setError('') }} autoFocus/>
        {error && <span className="admin-field__error">{error}</span>}
      </label>
      {mode === 'promotional' && <p style={{ margin: 0 }}>Promotional credits expire after {promoValidityDays} days (configurable in Settings → Reset policies).</p>}
      <label className="admin-field">
        <span className="admin-field__label">Reason (optional)</span>
        <textarea className="admin-textarea" value={reason} onChange={event => setReason(event.target.value)} placeholder="Why is this adjustment being made?"/>
      </label>
      {preview && (
        <div>
          <div className="admin-section-title">Balance preview</div>
          <div className="admin-balance-preview">
            <span className="admin-balance-preview__val">{formatCredits(preview.totalBefore)}</span>
            <span className="admin-balance-preview__arrow">→</span>
            <span className={`admin-balance-preview__val admin-balance-preview__val--after${mode === 'deduct' ? ' admin-balance-preview__val--drop' : ''}`}>{formatCredits(preview.totalAfter)}</span>
          </div>
          {preview.shortfalls > 0 && <p style={{ color: 'var(--a-red)', fontSize: 11.5 }}>{preview.shortfalls} account{preview.shortfalls > 1 ? 's' : ''} lack sufficient balance for this deduction and will be skipped.</p>}
          <p style={{ margin: '6px 0 0', fontSize: 11, color: 'var(--a-faint)' }}>Totals across all balance buckets (daily + permanent + promotional). The action is recorded in the audit log.</p>
        </div>
      )}
    </Modal>
  )
}
