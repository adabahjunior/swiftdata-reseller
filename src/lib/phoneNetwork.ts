import type { PackageNetworkId } from './constants'

/** Ghana mobile prefixes → package network id */
const PREFIX_NETWORK: Record<string, PackageNetworkId> = {
  // MTN
  '024': 'mtn',
  '054': 'mtn',
  '055': 'mtn',
  '059': 'mtn',
  '025': 'mtn',
  // Telecel (formerly Vodafone)
  '020': 'telecel',
  '050': 'telecel',
  // AirtelTigo
  '027': 'at_ishare',
  '057': 'at_ishare',
  '026': 'at_ishare',
  '056': 'at_ishare',
}

/**
 * Detect package network from a Ghana local number (0XXXXXXXXX).
 * AirtelTigo numbers default to at_ishare; pass atAirtelTigo to use at_bigtime instead.
 */
export function detectNetworkFromPhone(
  phone: string,
  atAirtelTigo: 'at_ishare' | 'at_bigtime' = 'at_ishare',
): PackageNetworkId | null {
  const digits = phone.replace(/\D/g, '')
  let local = digits
  if (digits.startsWith('233') && digits.length === 12) {
    local = `0${digits.slice(3)}`
  }
  if (!/^0[2-5]\d{8}$/.test(local)) return null

  const prefix = local.slice(0, 3)
  const network = PREFIX_NETWORK[prefix]
  if (!network) return null
  if (network === 'at_ishare' && atAirtelTigo === 'at_bigtime') return 'at_bigtime'
  return network
}

export function networkLabelFromPhone(phone: string): string | null {
  const n = detectNetworkFromPhone(phone)
  if (!n) return null
  if (n === 'mtn') return 'MTN'
  if (n === 'telecel') return 'Telecel'
  return 'AirtelTigo'
}
