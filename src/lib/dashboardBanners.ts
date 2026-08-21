import type { DashboardBanner } from '../types/database'
import { supabase } from './supabase'

export const BANNER_BUCKET = 'dashboard-banners'

export function bannerPublicUrl(imagePath: string): string {
  const { data } = supabase.storage.from(BANNER_BUCKET).getPublicUrl(imagePath)
  return data.publicUrl
}

export async function fetchActiveBanners(): Promise<DashboardBanner[]> {
  const { data, error } = await supabase
    .from('dashboard_banners')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as DashboardBanner[]) ?? []
}

export async function fetchAllBanners(): Promise<DashboardBanner[]> {
  const { data, error } = await supabase
    .from('dashboard_banners')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data as DashboardBanner[]) ?? []
}

export async function uploadBannerImage(file: File, userId: string): Promise<string> {
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const safeExt = ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext) ? ext : 'jpg'
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${safeExt}`

  const { error } = await supabase.storage.from(BANNER_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type || `image/${safeExt === 'jpg' ? 'jpeg' : safeExt}`,
  })
  if (error) throw error
  return path
}
