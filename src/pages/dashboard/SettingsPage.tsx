import { useEffect, useState } from 'react'
import { PageHeader, Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import { formatCurrency } from '../../lib/format'
import { supabase } from '../../lib/supabase'

export default function SettingsPage() {
  const { user, refreshProfile } = useAuth()
  const [fullName, setFullName] = useState(user?.full_name ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [lowBalanceThreshold, setLowBalanceThreshold] = useState(
    user?.low_balance_threshold != null ? String(user.low_balance_threshold) : '',
  )
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null)
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    if (user) {
      setFullName(user.full_name)
      setPhone(user.phone)
      setLowBalanceThreshold(
        user.low_balance_threshold != null ? String(user.low_balance_threshold) : '',
      )
    }
  }, [user])

  const handleSaveProfile = async () => {
    if (!user) return
    setSaving(true)
    setMessage(null)

    const trimmedThreshold = lowBalanceThreshold.trim()
    let thresholdValue: number | null = null
    if (trimmedThreshold !== '') {
      thresholdValue = Number(trimmedThreshold)
      if (Number.isNaN(thresholdValue) || thresholdValue < 0) {
        setSaving(false)
        setMessage('Low balance threshold must be a number 0 or greater (or leave blank to disable).')
        return
      }
    }

    const { error } = await supabase
      .from('profiles')
      .update({
        full_name: fullName.trim(),
        phone: phone.trim(),
        low_balance_threshold: thresholdValue,
      })
      .eq('id', user.id)

    setSaving(false)

    if (error) {
      setMessage(error.message)
      return
    }

    await refreshProfile()
    setMessage('Profile updated successfully.')
  }

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      setPasswordMessage('Password must be at least 6 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordMessage('Passwords do not match.')
      return
    }

    setChangingPassword(true)
    setPasswordMessage(null)

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    setChangingPassword(false)

    if (error) {
      setPasswordMessage(error.message)
      return
    }

    setNewPassword('')
    setConfirmPassword('')
    setPasswordMessage('Password updated successfully.')
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        title="Settings"
        description="Manage your account profile and security preferences."
      />

      <Panel title="Profile Information">
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="text-sm font-medium text-foreground/80">Email</label>
            <input
              value={user?.email ?? ''}
              disabled
              className="mt-1.5 w-full h-11 rounded-lg border border-white/10 bg-secondary/30 px-3 text-sm text-muted-foreground cursor-not-allowed"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground/80">Full Name</label>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1.5 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground/80">Phone</label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="0241234567"
              className="mt-1.5 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none focus:border-primary/40"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              Required for SMS alerts (wallet credit, failed orders, low balance).
            </p>
          </div>
          <div>
            <label className="text-sm font-medium text-foreground/80">Low balance SMS threshold (GHS)</label>
            <input
              type="number"
              step="0.01"
              min="0"
              value={lowBalanceThreshold}
              onChange={(e) => setLowBalanceThreshold(e.target.value)}
              placeholder="e.g. 20 — leave blank to disable"
              className="mt-1.5 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none focus:border-primary/40"
            />
            <p className="text-[11px] text-muted-foreground mt-1">
              When your balance drops to this amount or below, we SMS you to top up.
              {user?.wallet_balance != null && (
                <> Current balance: {formatCurrency(Number(user.wallet_balance))}.</>
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={saving}
            className="h-11 px-6 rounded-lg bg-primary text-primary-foreground font-bold disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
          {message && (
            <p className={`text-sm ${message.includes('success') ? 'text-emerald-400' : 'text-destructive'}`}>
              {message}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Change Password">
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="text-sm font-medium text-foreground/80">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
              className="mt-1.5 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="text-sm font-medium text-foreground/80">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={6}
              className="mt-1.5 w-full h-11 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none focus:border-primary/40"
            />
          </div>
          <button
            type="button"
            onClick={handleChangePassword}
            disabled={changingPassword}
            className="h-11 px-6 rounded-lg border border-white/10 font-bold hover:bg-white/5 disabled:opacity-60"
          >
            {changingPassword ? 'Updating…' : 'Update Password'}
          </button>
          {passwordMessage && (
            <p
              className={`text-sm ${
                passwordMessage.includes('success') ? 'text-emerald-400' : 'text-destructive'
              }`}
            >
              {passwordMessage}
            </p>
          )}
        </div>
      </Panel>

      <Panel title="Account">
        <dl className="space-y-3 text-sm max-w-lg">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">User ID</dt>
            <dd className="font-mono text-xs truncate">{user?.id}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Platform</dt>
            <dd>SwiftData Reseller API</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Built By</dt>
            <dd>SCQEEL TECHNOLOGIES</dd>
          </div>
        </dl>
      </Panel>
    </div>
  )
}
