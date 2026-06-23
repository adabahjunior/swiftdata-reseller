import * as XLSX from 'xlsx'
import { formatCurrency, formatDate, formatNetwork } from './format'
import type { Order, Profile } from '../types/database'

export type OrderWithProfile = Order & { profile?: Pick<Profile, 'full_name' | 'email'> }

export function ordersToExcelRows(orders: OrderWithProfile[]) {
  return orders.map((order) => ({
    Reference: order.reference,
    'User Name': order.profile?.full_name ?? '',
    'User Email': order.profile?.email ?? '',
    Phone: order.phone,
    Network: formatNetwork(order.network),
    'Size (GB)': order.size_gb,
    Amount: Number(order.amount),
    'Amount (GHS)': formatCurrency(Number(order.amount)),
    Status: order.status,
    Created: formatDate(order.created_at),
    Completed: order.completed_at ? formatDate(order.completed_at) : '',
  }))
}

export function downloadOrdersExcel(orders: OrderWithProfile[], fileLabel: string) {
  const rows = ordersToExcelRows(orders)
  const worksheet = XLSX.utils.json_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Orders')

  const colWidths = [
    { wch: 18 },
    { wch: 20 },
    { wch: 28 },
    { wch: 14 },
    { wch: 18 },
    { wch: 10 },
    { wch: 10 },
    { wch: 14 },
    { wch: 12 },
    { wch: 20 },
    { wch: 20 },
  ]
  worksheet['!cols'] = colWidths

  const safeName = fileLabel.replace(/[^\w.-]+/g, '_')
  XLSX.writeFile(workbook, `${safeName}.xlsx`)
}
