export type PlayerStats = {
  tasksCompleted: number
  timePlayedMs: number
}

type StatsTracker = {
  destroy: () => void
  getStats: () => PlayerStats
  incrementTasksCompleted: () => PlayerStats
  subscribe: (listener: (stats: PlayerStats) => void) => () => void
}

const ACTIVITY_IDLE_TIMEOUT_MS = 45_000
const DEFAULT_STATS: PlayerStats = {
  tasksCompleted: 0,
  timePlayedMs: 0,
}
const STATS_STORAGE_KEY = 'tpr-board.stats'
const TRACKING_TICK_MS = 5_000

function cloneStats(stats: PlayerStats): PlayerStats {
  return { ...stats }
}

export function createStatsTracker(): StatsTracker {
  const listeners = new Set<(stats: PlayerStats) => void>()
  let isDocumentVisible = document.visibilityState === 'visible'
  let isWindowFocused = document.hasFocus()
  let lastActivityAt = Date.now()
  let lastTrackedAt = Date.now()
  let stats = readPlayerStats()

  const emit = () => {
    const snapshot = cloneStats(stats)
    listeners.forEach((listener) => {
      listener(snapshot)
    })
  }

  const commit = () => {
    localStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(stats))
    emit()
  }

  const flushPlayedTime = (now = Date.now()) => {
    if (now <= lastTrackedAt) {
      return
    }

    let trackedElapsed = 0

    if (isDocumentVisible && isWindowFocused) {
      const activeUntil = Math.min(now, lastActivityAt + ACTIVITY_IDLE_TIMEOUT_MS)
      trackedElapsed = Math.max(0, activeUntil - lastTrackedAt)
    }

    lastTrackedAt = now

    if (trackedElapsed <= 0) {
      return
    }

    stats = {
      ...stats,
      timePlayedMs: stats.timePlayedMs + trackedElapsed,
    }
    commit()
  }

  const markActivity = () => {
    const now = Date.now()

    if (now - lastActivityAt >= ACTIVITY_IDLE_TIMEOUT_MS) {
      flushPlayedTime(now)
    }

    lastActivityAt = now
  }

  const handleVisibilityChange = () => {
    const now = Date.now()
    flushPlayedTime(now)
    isDocumentVisible = document.visibilityState === 'visible'

    if (isDocumentVisible) {
      lastActivityAt = now
    }
  }

  const handleWindowBlur = () => {
    flushPlayedTime()
    isWindowFocused = false
  }

  const handleWindowFocus = () => {
    const now = Date.now()
    flushPlayedTime(now)
    isWindowFocused = true
    lastActivityAt = now
  }

  const handlePageHide = () => {
    flushPlayedTime()
  }

  const intervalId = window.setInterval(() => {
    flushPlayedTime()
  }, TRACKING_TICK_MS)

  document.addEventListener('visibilitychange', handleVisibilityChange)
  window.addEventListener('focus', handleWindowFocus)
  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('pagehide', handlePageHide)
  window.addEventListener('keydown', markActivity, { passive: true })
  window.addEventListener('pointerdown', markActivity, { passive: true })
  window.addEventListener('pointermove', markActivity, { passive: true })

  return {
    destroy: () => {
      flushPlayedTime()
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('blur', handleWindowBlur)
      window.removeEventListener('pagehide', handlePageHide)
      window.removeEventListener('keydown', markActivity)
      window.removeEventListener('pointerdown', markActivity)
      window.removeEventListener('pointermove', markActivity)
    },
    getStats: () => {
      flushPlayedTime()
      return cloneStats(stats)
    },
    incrementTasksCompleted: () => {
      flushPlayedTime()
      stats = {
        ...stats,
        tasksCompleted: stats.tasksCompleted + 1,
      }
      commit()
      return cloneStats(stats)
    },
    subscribe: (listener) => {
      listeners.add(listener)
      listener(cloneStats(stats))

      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export function formatPlayedTime(timePlayedMs: number) {
  const totalSeconds = Math.max(0, Math.floor(timePlayedMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60

  if (hours > 0) {
    return `${hours}h ${minutes}m`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

function readPlayerStats(): PlayerStats {
  const rawStats = localStorage.getItem(STATS_STORAGE_KEY)

  if (!rawStats) {
    return cloneStats(DEFAULT_STATS)
  }

  try {
    const parsedStats = JSON.parse(rawStats) as Partial<PlayerStats>
    const tasksCompleted = Number(parsedStats.tasksCompleted)
    const timePlayedMs = Number(parsedStats.timePlayedMs)

    return {
      tasksCompleted: Number.isFinite(tasksCompleted) && tasksCompleted >= 0 ? tasksCompleted : 0,
      timePlayedMs: Number.isFinite(timePlayedMs) && timePlayedMs >= 0 ? timePlayedMs : 0,
    }
  } catch {
    return cloneStats(DEFAULT_STATS)
  }
}
