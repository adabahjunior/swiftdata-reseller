import type { Order } from '../types/database'
import { formatNetwork } from './format'

export type MashupPackage = {
  id: string
  code: string
  title: string
  price: number
  mb: number
  capacity: number
  onnet_mins: number
  offnet_mins: number
  sms: number
  validity_days: number
}

export type AdminMashupPackage = MashupPackage & {
  combo_cost: number
  cost_price: number
  active: boolean
  available: boolean
  synced_at: string | null
}

export const MTN_MASHUP_PREFIXES = ['024', '025', '053', '054', '055', '059'] as const

/** Accepts 0XXXXXXXXX, 233XXXXXXXXX or +233 XX XXX XXXX and returns the 0-prefixed form. */
export function normalizeMashupPhone(phone: string) {
  const digits = phone.replace(/[\s+\-()]/g, '')
  return /^233\d{9}$/.test(digits) ? `0${digits.slice(3)}` : digits
}

export function isMtnMashupNumber(phone: string) {
  return /^0(24|25|53|54|55|59)\d{7}$/.test(normalizeMashupPhone(phone))
}

export function formatMashupData(mb: number) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 2)} GB` : `${mb} MB`
}

/** What an order bought, for order lists (data, MashUp or utilities). */
export function orderProductLabel(order: Pick<Order, 'service_type' | 'size_gb' | 'network' | 'utility_meta' | 'face_amount'>) {
  const meta = order.utility_meta ?? {}
  if (order.service_type === 'mashup') return String(meta.title ?? 'MTN MashUp')
  if (order.service_type && order.service_type !== 'data') {
    return `${order.service_type.toUpperCase()} ₵${Number(order.face_amount ?? 0).toFixed(2)}`
  }
  return `${order.size_gb} GB`
}

/** Network column for order lists. */
export function orderNetworkLabel(order: Pick<Order, 'service_type' | 'network'>) {
  if (order.service_type === 'mashup') return 'MTN MashUp'
  return formatNetwork(order.network)
}
