import {
  Loader2,
  Lock,
  Mail,
  Phone,
  Sparkles,
  User,
} from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthBackground } from '../components/AuthBackground'
import { AuthField } from '../components/AuthField'
import { PasswordInput } from '../components/PasswordInput'
import { useAuth } from '../context/AuthContext'

type Tab = 'signin' | 'signup'

export default function AuthPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user, signIn, signUp } = useAuth()

  const referralCode = useMemo(
    () => searchParams.get('ref')?.trim().toUpperCase() ?? '',
    [searchParams],
  )
  const redirectTo = searchParams.get('redirect') ?? '/dashboard'

  const [submitting, setSubmitting] = useState(false)
  const [tab, setTab] = useState<Tab>('signin')
  const [error, setError] = useState<string | null>(null)
  const [signInForm, setSignInForm] = useState({ email: '', password: '' })
  const [signUpForm, setSignUpForm] = useState({
    email: '',
    password: '',
    full_name: '',
    phone: '',
  })

  useEffect(() => {
    if (user) {
      navigate(redirectTo, { replace: true })
    }
  }, [user, navigate, redirectTo])

  useEffect(() => {
    if (referralCode) {
      localStorage.setItem('swiftdata_ref', referralCode)
      setTab('signup')
    }
  }, [referralCode])

  const handleSignIn = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const result = await signIn(signInForm.email, signInForm.password)
    setSubmitting(false)

    if (result.error) {
      setError(result.error)
      return
    }
  }

  const handleSignUp = async (event: FormEvent) => {
    event.preventDefault()
    setSubmitting(true)
    setError(null)

    const ref = referralCode || localStorage.getItem('swiftdata_ref') || ''
    const result = await signUp(signUpForm, ref || undefined)

    setSubmitting(false)

    if (result.error) {
      setError(result.error)
      return
    }

    if (ref) {
      localStorage.removeItem('swiftdata_ref')
    }
  }

  if (user) {
    return (
      <div className="min-h-screen grid place-items-center bg-background text-muted-foreground gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Taking you to your dashboard…</p>
      </div>
    )
  }

  return (
    <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-6 overflow-hidden bg-gradient-to-br from-background via-background to-primary/[0.07]">
      <AuthBackground />

      <div className="relative w-full max-w-md z-10">
        <div className="text-center mb-8 animate-fade-in-up">
          <Link to="/auth" className="inline-flex items-center gap-3 mb-5 group">
            <div className="relative">
              <div className="absolute inset-0 rounded-2xl bg-primary/30 blur-xl scale-110 group-hover:scale-125 transition-transform duration-500" />
              <div className="relative h-14 w-14 rounded-2xl bg-primary grid place-items-center font-black text-primary-foreground text-2xl glow-yellow group-hover:scale-105 transition-transform duration-300">
                S
              </div>
            </div>
            <span className="font-display font-bold text-3xl sm:text-4xl text-gradient-yellow">SwiftData Reseller</span>
          </Link>
          <p className="text-muted-foreground text-sm sm:text-base flex items-center justify-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary/70" />
            The smartest way to resell data in Ghana
            <Sparkles className="h-3.5 w-3.5 text-primary/70" />
          </p>
        </div>

        <div className="auth-card-glass rounded-2xl p-6 sm:p-8 animate-fade-in-up animation-delay-200">
          <div className="grid grid-cols-2 w-full mb-7 h-11 bg-secondary/60 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => {
                setTab('signin')
                setError(null)
              }}
              className={`rounded-lg font-semibold text-sm transition-all duration-300 ${
                tab === 'signin'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('signup')
                setError(null)
              }}
              className={`rounded-lg font-semibold text-sm transition-all duration-300 ${
                tab === 'signup'
                  ? 'bg-primary text-primary-foreground shadow-md'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              Sign Up
            </button>
          </div>

          {error && (
            <p className="mb-4 text-sm text-destructive rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2">
              {error}
            </p>
          )}

          {tab === 'signin' ? (
            <form onSubmit={handleSignIn} className="space-y-4">
              <AuthField label="Email" icon={Mail} delay="animation-delay-300">
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={signInForm.email}
                  onChange={(event) =>
                    setSignInForm({ ...signInForm, email: event.target.value })
                  }
                  className="w-full h-10 rounded-lg border bg-secondary/50 px-3 text-sm outline-none"
                />
              </AuthField>

              <AuthField label="Password" icon={Lock} delay="animation-delay-500">
                <PasswordInput
                  required
                  placeholder="Enter your password"
                  value={signInForm.password}
                  onChange={(event) =>
                    setSignInForm({ ...signInForm, password: event.target.value })
                  }
                />
              </AuthField>

              <div className="pt-2 animate-fade-in-up animation-delay-700">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 font-semibold text-base rounded-lg bg-primary text-primary-foreground transition-all duration-300 hover:shadow-[0_0_24px_hsl(51_100%_50%/0.35)] disabled:opacity-60"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Signing in…
                    </span>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleSignUp} className="space-y-4">
              {referralCode && (
                <p className="text-sm text-primary mb-4 rounded-lg bg-primary/10 border border-primary/20 px-3 py-2">
                  You were referred! Your friend earns bonus points when you sign up.
                </p>
              )}

              <AuthField label="Full Name" icon={User} delay="animation-delay-300">
                <input
                  required
                  placeholder="John Doe"
                  value={signUpForm.full_name}
                  onChange={(event) =>
                    setSignUpForm({ ...signUpForm, full_name: event.target.value })
                  }
                  className="w-full h-10 rounded-lg border bg-secondary/50 px-3 text-sm outline-none"
                />
              </AuthField>

              <AuthField label="Phone" icon={Phone} delay="animation-delay-400">
                <input
                  required
                  placeholder="0241234567"
                  value={signUpForm.phone}
                  onChange={(event) =>
                    setSignUpForm({ ...signUpForm, phone: event.target.value })
                  }
                  className="w-full h-10 rounded-lg border bg-secondary/50 px-3 text-sm outline-none"
                />
              </AuthField>

              <AuthField label="Email" icon={Mail} delay="animation-delay-500">
                <input
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={signUpForm.email}
                  onChange={(event) =>
                    setSignUpForm({ ...signUpForm, email: event.target.value })
                  }
                  className="w-full h-10 rounded-lg border bg-secondary/50 px-3 text-sm outline-none"
                />
              </AuthField>

              <AuthField label="Password" icon={Lock} delay="animation-delay-600">
                <PasswordInput
                  required
                  minLength={6}
                  placeholder="Min. 6 characters"
                  value={signUpForm.password}
                  onChange={(event) =>
                    setSignUpForm({ ...signUpForm, password: event.target.value })
                  }
                />
              </AuthField>

              <div className="pt-2 animate-fade-in-up animation-delay-700">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-11 font-semibold text-base rounded-lg bg-primary text-primary-foreground transition-all duration-300 hover:shadow-[0_0_24px_hsl(51_100%_50%/0.35)] disabled:opacity-60"
                >
                  {submitting ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Creating account…
                    </span>
                  ) : (
                    'Create Account'
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground/60 mt-6 animate-fade-in animation-delay-1000">
          Built By SCQEEL TECHNOLOGIES
        </p>
      </div>
    </div>
  )
}
