import { useEffect, useRef, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
} from 'firebase/auth'
import { LogOut, X } from 'lucide-react'
import { auth, googleProvider } from '@/lib/firebase'
import { useAuth } from '@/lib/auth-context'
import './auth-button.css'

type Mode = 'login' | 'signup'

interface AuthModalProps {
  onClose: () => void
  initialMode?: Mode
}

export function AuthModal({ onClose, initialMode = 'login' }: AuthModalProps) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const switchMode = (m: Mode) => { setMode(m); setError(''); setName('') }

  const handleGoogle = async () => {
    setBusy(true); setError('')
    try {
      await signInWithPopup(auth, googleProvider)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.'
      setError(msg.replace('Firebase: ', '').replace(/ \(auth\/.*\)\.?/, ''))
    } finally { setBusy(false) }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setError('')
    try {
      if (mode === 'signup') await createUserWithEmailAndPassword(auth, email, password)
      else await signInWithEmailAndPassword(auth, email, password)
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.'
      setError(msg.replace('Firebase: ', '').replace(/ \(auth\/.*\)\.?/, ''))
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-overlay" role="dialog" aria-modal="true" aria-label={mode === 'login' ? 'Sign in' : 'Create account'} style={{ colorScheme: 'light' }}>
      <div className="auth-modal" ref={modalRef} style={{ colorScheme: 'light' }}>

        {/* Close */}
        <button className="auth-modal__close" onClick={onClose} aria-label="Close"><X size={15} /></button>

        {/* Logo + headline */}
        <div className="auth-modal__brand">
          <img src="/wireup-logo.png" alt="" className="auth-modal__logo" />
          <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
          <p>{mode === 'login' ? 'Sign in to continue building.' : 'Start prototyping hardware with AI.'}</p>
        </div>

        {/* Google */}
        <button className="auth-google" onClick={handleGoogle} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider"><span>or</span></div>

        {/* Email form */}
        <form onSubmit={handleSubmit} className="auth-form">
          {mode === 'signup' && (
            <div className="auth-field">
              <label htmlFor="auth-name">Full name</label>
              <input id="auth-name" type="text" placeholder="Ada Lovelace" value={name}
                onChange={e => setName(e.target.value)} autoComplete="name" disabled={busy} />
            </div>
          )}
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input id="auth-email" type="email" placeholder="you@example.com" value={email}
              onChange={e => setEmail(e.target.value)} required autoComplete="email" disabled={busy} />
          </div>
          <div className="auth-field">
            <div className="auth-field__row">
              <label htmlFor="auth-password">Password</label>
              {mode === 'login' && <button type="button" className="auth-forgot">Forgot password?</button>}
            </div>
            <input id="auth-password" type="password"
              placeholder={mode === 'signup' ? 'At least 8 characters' : '••••••••'}
              value={password} onChange={e => setPassword(e.target.value)} required
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} disabled={busy} />
          </div>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <button type="submit" className="auth-submit" disabled={busy || !email || !password}>
            {busy
              ? <span className="auth-spinner" />
              : mode === 'login' ? 'Sign in' : 'Create account'
            }
          </button>
        </form>

        <p className="auth-switch">
          {mode === 'login'
            ? <>Don't have an account? <button onClick={() => switchMode('signup')}>Sign up free</button></>
            : <>Already have an account? <button onClick={() => switchMode('login')}>Sign in</button></>
          }
        </p>

        <p className="auth-terms">
          By continuing you agree to our <a href="#">Terms</a> and <a href="#">Privacy Policy</a>.
        </p>
      </div>
    </div>
  )
}

export function AuthButton() {
  const { user, loading } = useAuth()
  const [open, setOpen] = useState(false)

  const handleSignOut = async () => { await signOut(auth) }

  if (loading) return null

  if (user) {
    return (
      <div className="auth-user">
        {user.photoURL
          ? <img src={user.photoURL} alt={user.displayName ?? 'User'} className="auth-user__avatar" referrerPolicy="no-referrer" />
          : <span className="auth-user__initials">{(user.displayName ?? user.email ?? 'U')[0].toUpperCase()}</span>
        }
        <span className="auth-user__name">{user.displayName ?? user.email}</span>
        <button className="auth-user__signout" onClick={handleSignOut} title="Sign out"><LogOut size={14} /></button>
      </div>
    )
  }

  return (
    <>
      <button className="auth-trigger" onClick={() => setOpen(true)}>
        Sign in
      </button>
      {open && <AuthModal onClose={() => setOpen(false)} />}
    </>
  )
}
