import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { bannerPublicUrl, fetchActiveBanners } from '../../lib/dashboardBanners'
import type { DashboardBanner } from '../../types/database'

const ROTATE_MS = 5_000

export function DashboardBannerCarousel() {
  const [banners, setBanners] = useState<DashboardBanner[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const rows = await fetchActiveBanners()
        if (!cancelled) setBanners(rows)
      } catch {
        if (!cancelled) setBanners([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const count = banners.length
  const go = useCallback(
    (dir: -1 | 1) => {
      if (count <= 1) return
      setIndex((i) => (i + dir + count) % count)
    },
    [count],
  )

  useEffect(() => {
    if (count <= 1) return
    const id = window.setInterval(() => go(1), ROTATE_MS)
    return () => window.clearInterval(id)
  }, [count, go])

  useEffect(() => {
    if (index >= count) setIndex(0)
  }, [count, index])

  if (loading || count === 0) return null

  const current = banners[index]
  const src = bannerPublicUrl(current.image_path)
  const slide = (
    <img
      src={src}
      alt={current.title || 'Banner'}
      className="w-full h-full object-cover"
      draggable={false}
    />
  )

  return (
    <div className="relative w-full overflow-hidden rounded-2xl border border-white/10 bg-black/40 aspect-[21/9] min-h-[140px] max-h-[280px]">
      {current.link_url ? (
        <a href={current.link_url} target="_blank" rel="noopener noreferrer" className="block h-full w-full">
          {slide}
        </a>
      ) : (
        slide
      )}

      {count > 1 && (
        <>
          <button
            type="button"
            aria-label="Previous banner"
            onClick={() => go(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 border border-white/10 grid place-items-center text-white hover:bg-black/70"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label="Next banner"
            onClick={() => go(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/50 border border-white/10 grid place-items-center text-white hover:bg-black/70"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-1.5">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                aria-label={`Go to banner ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/40 hover:bg-white/70'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
