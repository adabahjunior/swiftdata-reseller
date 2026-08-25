import * as XLSX from 'xlsx'
import {
  isAllowedMtnVerifyPhone,
  normalizeVerifyPhone,
  parseVerifyPhones,
} from '../components/NumberVerificationSubmitForm'

export type PhoneAnalysis = {
  valid: string[]
  invalid: string[]
  total: number
}

export type ExtractedFile = {
  fileName: string
  validNumbers: string[]
  totalScanned: number
  invalidCount: number
}

export function analyzeVerifyText(text: string): PhoneAnalysis {
  const parts = text
    .split(/[\n,;]+/)
    .map((p) => normalizeVerifyPhone(p))
    .filter(Boolean)
  const unique = [...new Set(parts)]
  const valid = unique.filter(isAllowedMtnVerifyPhone)
  const invalid = unique.filter((p) => !isAllowedMtnVerifyPhone(p))
  return { valid, invalid, total: unique.length }
}

export function extractNumbersFromWorkbook(buffer: ArrayBuffer): { phones: string[]; scanned: number } {
  const wb = XLSX.read(buffer, { type: 'array' })
  const phones: string[] = []
  let scanned = 0
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name]
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
      header: 1,
      raw: false,
      defval: '',
    })
    for (const row of rows) {
      for (const cell of row) {
        const raw = String(cell ?? '').trim()
        if (!raw) continue
        scanned += 1
        const phone = normalizeVerifyPhone(raw)
        if (phone) phones.push(phone)
      }
    }
  }
  return { phones, scanned }
}

export async function parseVerifyFile(file: File): Promise<ExtractedFile> {
  const name = file.name.toLowerCase()
  if (!/\.(xlsx|xls|csv|tsv|txt)$/.test(name)) {
    throw new Error('Please upload an Excel (.xlsx, .xls) or CSV/TXT file.')
  }

  const buffer = await file.arrayBuffer()
  let phones: string[] = []
  let scanned = 0

  if (name.endsWith('.csv') || name.endsWith('.tsv') || name.endsWith('.txt')) {
    const raw = new TextDecoder().decode(buffer)
    const parts = raw.split(/[\n,;\t]+/).map((p) => normalizeVerifyPhone(p)).filter(Boolean)
    scanned = parts.length
    phones = parts
  } else {
    const extracted = extractNumbersFromWorkbook(buffer)
    phones = extracted.phones
    scanned = extracted.scanned
  }

  const unique = [...new Set(phones)]
  const valid = unique.filter(isAllowedMtnVerifyPhone)
  const invalidCount = unique.length - valid.length

  return {
    fileName: file.name,
    validNumbers: valid,
    totalScanned: scanned,
    invalidCount,
  }
}

export function downloadVerifySampleXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([['phone'], ['0538122730'], ['0241234567'], ['0554226398']])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Numbers')
  XLSX.writeFile(wb, 'mtn-numbers-sample.xlsx')
}

export { parseVerifyPhones, normalizeVerifyPhone, isAllowedMtnVerifyPhone }
