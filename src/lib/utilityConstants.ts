export const UTILITY_SERVICES = [
  { id: 'airtime', label: 'Airtime', beneficiaryLabel: 'Phone number', beneficiaryHint: 'e.g. 0241234567' },
  { id: 'ecg', label: 'ECG', beneficiaryLabel: 'Meter / bill number', beneficiaryHint: 'ECG meter or account number' },
  { id: 'tv', label: 'TV Subscriptions', beneficiaryLabel: 'Smartcard / IUC', beneficiaryHint: 'DSTV / GOtv / StarTimes number' },
] as const

export type UtilityServiceId = (typeof UTILITY_SERVICES)[number]['id']

export type UtilityProduct = {
  id: string
  service_type: UtilityServiceId
  provider_code: string
  label: string
  min_amount: number
  max_amount: number
  markup_percent: number
  flat_fee: number
  xcel_merchant_id: string | null
  xcel_to_acct: string | null
  xcel_biller_wallet_num: string | null
  xcel_account_name: string | null
  bill_sub_type: string | null
  xcel_type: string | null
  active: boolean
  display_order: number
}

export function chargeForUtility(
  faceAmount: number,
  product: Pick<UtilityProduct, 'markup_percent' | 'flat_fee'>,
) {
  const face = Math.max(Number(faceAmount) || 0, 0)
  const markup = Math.max(Number(product.markup_percent) || 0, 0)
  const fee = Math.max(Number(product.flat_fee) || 0, 0)
  return Math.round((face + (face * markup) / 100 + fee) * 100) / 100
}
