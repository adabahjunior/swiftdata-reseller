import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { EmptyState, PageHeader, Panel } from '../../components/dashboard/ui'
import { useAuth } from '../../context/AuthContext'
import {
  BANNER_BUCKET,
  bannerPublicUrl,
  fetchAllBanners,
  uploadBannerImage,
} from '../../lib/dashboardBanners'
import { formatDate } from '../../lib/format'
import { supabase } from '../../lib/supabase'
import type { DashboardBanner } from '../../types/database'

export default function AdminBannersPage() {
  const { user } = useAuth()
  const [banners, setBanners] = useState<DashboardBanner[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setBanners(await fetchAllBanners())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!file) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const handleUpload = async () => {
    if (!user || !file) {
      setError('Choose an image to upload')
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Only image files are allowed')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Image must be 5MB or smaller')
      return
    }

    setSaving(true)
    setError(null)
    setMessage(null)
    try {
      const imagePath = await uploadBannerImage(file, user.id)
      const nextOrder =
        banners.length > 0 ? Math.max(...banners.map((b) => b.sort_order)) + 1 : 0

      const { error: insertError } = await supabase.from('dashboard_banners').insert({
        title: title.trim() || null,
        image_path: imagePath,
        link_url: linkUrl.trim() || null,
        sort_order: nextOrder,
        is_active: true,
        created_by: user.id,
      })
      if (insertError) throw insertError

      setTitle('')
      setLinkUrl('')
      setFile(null)
      setMessage('Banner uploaded')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const toggleActive = async (banner: DashboardBanner) => {
    await supabase
      .from('dashboard_banners')
      .update({ is_active: !banner.is_active, updated_at: new Date().toISOString() })
      .eq('id', banner.id)
    await load()
  }

  const updateSort = async (banner: DashboardBanner, sortOrder: number) => {
    await supabase
      .from('dashboard_banners')
      .update({ sort_order: sortOrder, updated_at: new Date().toISOString() })
      .eq('id', banner.id)
    await load()
  }

  const deleteBanner = async (banner: DashboardBanner) => {
    if (!confirm('Delete this banner?')) return
    await supabase.storage.from(BANNER_BUCKET).remove([banner.image_path])
    await supabase.from('dashboard_banners').delete().eq('id', banner.id)
    await load()
  }

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader title="Dashboard Banners" />

      <Panel title="Upload banner image">
        <div className="space-y-4 max-w-xl">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Image *</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:h-9 file:rounded-lg file:border-0 file:bg-red-500 file:px-3 file:text-sm file:font-bold file:text-white"
            />
          </div>

          {preview && (
            <div className="rounded-xl overflow-hidden border border-white/10 aspect-[21/9] bg-black/40">
              <img src={preview} alt="Preview" className="w-full h-full object-cover" />
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-muted-foreground">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
              placeholder="Promo title"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Link URL (optional)</label>
            <input
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              className="mt-1 w-full h-10 rounded-lg border border-white/10 bg-secondary/50 px-3 text-sm outline-none"
              placeholder="https://…"
            />
          </div>

          <button
            type="button"
            disabled={saving || !file}
            onClick={() => void handleUpload()}
            className="inline-flex items-center gap-2 h-10 px-5 rounded-lg bg-red-500 text-white text-sm font-bold disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {saving ? 'Uploading…' : 'Upload banner'}
          </button>

          {error && <p className="text-sm text-red-400">{error}</p>}
          {message && <p className="text-sm text-emerald-400">{message}</p>}
        </div>
      </Panel>

      <Panel title="Banners">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : banners.length === 0 ? (
          <EmptyState title="No banners yet" />
        ) : (
          <div className="space-y-4">
            {banners.map((banner) => (
              <div
                key={banner.id}
                className="flex flex-col sm:flex-row gap-4 rounded-xl border border-white/10 p-3"
              >
                <div className="sm:w-56 shrink-0 rounded-lg overflow-hidden border border-white/10 aspect-[21/9] bg-black/40">
                  <img
                    src={bannerPublicUrl(banner.image_path)}
                    alt={banner.title || 'Banner'}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="font-medium truncate">{banner.title || 'Untitled'}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {banner.link_url || 'No link'} · {formatDate(banner.created_at)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-muted-foreground">Order</label>
                    <input
                      type="number"
                      value={banner.sort_order}
                      onChange={(e) => void updateSort(banner, Number(e.target.value) || 0)}
                      className="h-8 w-20 rounded-lg border border-white/10 bg-secondary/50 px-2 text-sm outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => void toggleActive(banner)}
                      className={`h-8 px-3 rounded-lg border text-xs font-bold ${
                        banner.is_active
                          ? 'border-emerald-500/40 text-emerald-400'
                          : 'border-white/10 text-muted-foreground'
                      }`}
                    >
                      {banner.is_active ? 'Active' : 'Hidden'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteBanner(banner)}
                      className="h-8 w-8 rounded-lg border border-white/10 grid place-items-center text-red-400 hover:bg-red-500/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}
