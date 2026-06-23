export interface Profile {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  wallet_balance: number
  points_balance: number
  referral_code: string | null
  referred_by: string | null
  is_admin: boolean
  topup_code: string
  is_active: boolean
  api_enabled: boolean
  created_at: string
  updated_at: string
}

export interface DataPackage {
  id: string
  network: string
  size_gb: number
  price: number
  validity: string
  active: boolean
  created_at: string
}

export interface ApiKey {
  id: string
  user_id: string
  name: string
  key_value: string
  key_prefix: string
  is_active: boolean
  requests_count: number
  last_used_at: string | null
  created_at: string
}

export interface Order {
  id: string
  user_id: string
  reference: string
  phone: string
  network: string
  package_id: string | null
  size_gb: number
  amount: number
  status: 'pending' | 'processing' | 'completed' | 'failed'
  api_key_id: string | null
  failure_reason: string | null
  created_at: string
  completed_at: string | null
  export_download_id: string | null
}

export interface Transaction {
  id: string
  user_id: string
  type: 'credit' | 'debit'
  amount: number
  description: string
  reference: string | null
  created_at: string
}

export interface ApiLog {
  id: string
  user_id: string
  api_key_id: string | null
  endpoint: string
  method: string
  status_code: number
  response_time_ms: number
  created_at: string
}

export interface SiteSetting {
  key: string
  value: string
  label: string | null
  updated_at: string
  updated_by: string | null
}

export interface Notification {
  id: string
  title: string
  message: string
  type: 'info' | 'warning' | 'success' | 'error'
  is_active: boolean
  target: 'all' | 'users' | 'admins'
  created_by: string | null
  created_at: string
  expires_at: string | null
}

export interface OrderExportDownload {
  id: string
  order_ids: string[]
  order_count: number
  first_order_at: string | null
  last_order_at: string | null
  downloaded_at: string
  downloaded_by: string | null
  download_count: number
  file_label: string
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: Profile
        Insert: {
          id: string
          full_name?: string | null
          phone?: string | null
          email?: string | null
          wallet_balance?: number
          points_balance?: number
          referral_code?: string | null
          referred_by?: string | null
        }
        Update: {
          full_name?: string | null
          phone?: string | null
          email?: string | null
          wallet_balance?: number
          points_balance?: number
        }
        Relationships: []
      }
      data_packages: {
        Row: DataPackage
        Insert: {
          network: string
          size_gb: number
          price: number
          validity?: string
          active?: boolean
        }
        Update: {
          network?: string
          size_gb?: number
          price?: number
          validity?: string
          active?: boolean
        }
        Relationships: []
      }
      api_keys: {
        Row: ApiKey
        Insert: {
          user_id: string
          name?: string
          key_value: string
          key_prefix: string
          is_active?: boolean
        }
        Update: {
          name?: string
          is_active?: boolean
          requests_count?: number
          last_used_at?: string | null
        }
        Relationships: []
      }
      orders: {
        Row: Order
        Insert: {
          user_id: string
          reference: string
          phone: string
          network: string
          size_gb: number
          amount: number
          package_id?: string | null
          status?: Order['status']
          api_key_id?: string | null
        }
        Update: {
          status?: Order['status']
          completed_at?: string | null
          failure_reason?: string | null
        }
        Relationships: []
      }
      transactions: {
        Row: Transaction
        Insert: {
          user_id: string
          type: 'credit' | 'debit'
          amount: number
          description: string
          reference?: string | null
        }
        Update: {
          type?: 'credit' | 'debit'
          amount?: number
          description?: string
          reference?: string | null
        }
        Relationships: []
      }
      api_logs: {
        Row: ApiLog
        Insert: {
          user_id: string
          endpoint: string
          status_code: number
          method?: string
          response_time_ms?: number
          api_key_id?: string | null
        }
        Update: {
          endpoint?: string
          status_code?: number
          method?: string
          response_time_ms?: number
        }
        Relationships: []
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
    CompositeTypes: Record<string, never>
  }
}

export interface AppUser {
  id: string
  email: string
  full_name: string
  phone: string
  wallet_balance: number
  points_balance: number
  is_admin: boolean
  topup_code: string
  is_active: boolean
  api_enabled: boolean
}

export function profileToAppUser(profile: Profile, email: string): AppUser {
  return {
    id: profile.id,
    email: profile.email ?? email,
    full_name: profile.full_name ?? '',
    phone: profile.phone ?? '',
    wallet_balance: Number(profile.wallet_balance ?? 0),
    points_balance: Number(profile.points_balance ?? 0),
    is_admin: Boolean(profile.is_admin),
    topup_code: profile.topup_code ?? '',
    is_active: profile.is_active ?? true,
    api_enabled: profile.api_enabled ?? true,
  }
}
