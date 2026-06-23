import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'

interface AuthFieldProps {
  label: string
  icon: LucideIcon
  delay?: string
  children: ReactNode
}

export function AuthField({ label, icon: Icon, delay, children }: AuthFieldProps) {
  return (
    <div className={`space-y-1.5 animate-fade-in-up ${delay ?? ''}`}>
      <label className="text-sm font-medium text-foreground/80">{label}</label>
      <div className="relative group">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground group-focus-within:text-primary transition-colors pointer-events-none z-10" />
        <div className="[&_input]:pl-9 [&_input]:bg-secondary/50 [&_input]:border-border/60 [&_input]:transition-all [&_input]:duration-200 [&_input]:focus:bg-background [&_input]:focus:border-primary/40 [&_input]:focus:shadow-[0_0_0_3px_hsl(51_100%_50%/0.1)]">
          {children}
        </div>
      </div>
    </div>
  )
}
