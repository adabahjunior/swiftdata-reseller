import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'

export type NavItem = {
  label: string
  to: string
  icon: string
}

export type NavGroup = {
  id: string
  label: string
  items: readonly NavItem[]
}

function pathActive(pathname: string, to: string, rootPath: string) {
  if (to === rootPath) return pathname === rootPath
  return pathname.startsWith(to)
}

function groupHasActive(pathname: string, group: NavGroup, rootPath: string) {
  return group.items.some((item) => pathActive(pathname, item.to, rootPath))
}

export function SidebarNavGroups({
  groups,
  pathname,
  rootPath,
  icons,
  onNavigate,
  activeClass,
  idleClass,
}: {
  groups: readonly NavGroup[]
  pathname: string
  rootPath: string
  icons: Record<string, LucideIcon>
  onNavigate?: () => void
  activeClass: string
  idleClass: string
}) {
  const [openIds, setOpenIds] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    for (const g of groups) {
      initial[g.id] = groupHasActive(pathname, g, rootPath) || g.id === 'main'
    }
    return initial
  })

  useEffect(() => {
    setOpenIds((prev) => {
      const next = { ...prev }
      for (const g of groups) {
        if (groupHasActive(pathname, g, rootPath)) next[g.id] = true
      }
      return next
    })
  }, [pathname, groups, rootPath])

  const toggle = (id: string) => {
    setOpenIds((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="space-y-2">
      {groups.map((group) => {
        const open = openIds[group.id] ?? false
        const sectionActive = groupHasActive(pathname, group, rootPath)

        return (
          <div key={group.id} className="space-y-0.5">
            <button
              type="button"
              onClick={() => toggle(group.id)}
              className={`w-full flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-[11px] font-black uppercase tracking-wider transition-colors ${
                sectionActive
                  ? 'text-foreground/90'
                  : 'text-muted-foreground/80 hover:text-foreground hover:bg-white/5'
              }`}
              aria-expanded={open}
            >
              <span>{group.label}</span>
              <ChevronDown
                className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 ${
                  open ? 'rotate-0' : '-rotate-90'
                }`}
              />
            </button>

            {open && (
              <div className="space-y-0.5 pl-0.5">
                {group.items.map((item) => {
                  const Icon = icons[item.icon]
                  const active = pathActive(pathname, item.to, rootPath)
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onNavigate}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium transition-colors ${
                        active ? activeClass : idleClass
                      }`}
                    >
                      {Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
                      {item.label}
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export function SidebarSection({ children }: { children: ReactNode }) {
  return <div className="space-y-1">{children}</div>
}
