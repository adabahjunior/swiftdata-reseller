export default function ConfigError() {
  return (
    <div className="min-h-screen grid place-items-center p-6 bg-[#0f0f0f] text-[#fffbeb]">
      <div className="max-w-md text-center space-y-4">
        <h1 className="text-2xl font-bold">Configuration Error</h1>
        <p className="text-sm text-[#a3a3a3]">
          Supabase environment variables are missing from this deployment. Add{' '}
          <code className="text-[#ffdf00]">VITE_SUPABASE_URL</code> and{' '}
          <code className="text-[#ffdf00]">VITE_SUPABASE_ANON_KEY</code> in Vercel project settings,
          then redeploy.
        </p>
      </div>
    </div>
  )
}
