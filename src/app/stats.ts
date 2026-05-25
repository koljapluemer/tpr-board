export type PlayerStats = {
  bestStreak: number
  currentStreak: number
  recordStreakBaseline: number
  tasksCompleted: number
  timePlayedMs: number
}

type StatsTracker = {
  breakStreak: () => PlayerStats
  destroy: () => void
  getStats: () => PlayerStats
  recordCompletedTask: (wasPerfectRound: boolean) => PlayerStats
  subscribe: (listener: (stats: PlayerStats) => void) => () => void
}

const ACTIVITY_IDLE_TIMEOUT_MS = 45_000
const DEFAULT_STATS: PlayerStats = {
  bestStreak: 0,
  currentStreak: 0,
  recordStreakBaseline: 0,
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
    breakStreak: () => {
      flushPlayedTime()

      if (stats.currentStreak === 0) {
        return cloneStats(stats)
      }

      stats = {
        ...stats,
        currentStreak: 0,
        recordStreakBaseline: stats.bestStreak,
      }
      commit()
      return cloneStats(stats)
    },
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
    recordCompletedTask: (wasPerfectRound) => {
      flushPlayedTime()

      let currentStreak = stats.currentStreak
      let bestStreak = stats.bestStreak
      let recordStreakBaseline = stats.recordStreakBaseline

      if (wasPerfectRound) {
        if (currentStreak === 0) {
          recordStreakBaseline = bestStreak
        }

        currentStreak += 1

        if (currentStreak > bestStreak) {
          bestStreak = currentStreak
        }
      } else if (currentStreak > 0) {
        currentStreak = 0
        recordStreakBaseline = bestStreak
      }

      stats = {
        ...stats,
        bestStreak,
        currentStreak,
        recordStreakBaseline,
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

function readStoredCount(value: unknown) {
  const count = Number(value)

  if (!Number.isFinite(count) || count < 0) {
    return 0
  }

  return Math.floor(count)
}

function readPlayerStats(): PlayerStats {
  const rawStats = localStorage.getItem(STATS_STORAGE_KEY)

  if (!rawStats) {
    return cloneStats(DEFAULT_STATS)
  }

  try {
    const parsedStats = JSON.parse(rawStats) as Partial<PlayerStats>
    const tasksCompleted = readStoredCount(parsedStats.tasksCompleted)
    const timePlayedMs = readStoredCount(parsedStats.timePlayedMs)
    const currentStreak = readStoredCount(parsedStats.currentStreak)
    const bestStreak = Math.max(readStoredCount(parsedStats.bestStreak), currentStreak)
    const hasStoredRecordBaseline = Object.prototype.hasOwnProperty.call(parsedStats, 'recordStreakBaseline')
    const rawRecordBaseline = readStoredCount(parsedStats.recordStreakBaseline)
    const recordStreakBaseline =
      currentStreak === 0
        ? bestStreak
        : Math.min(hasStoredRecordBaseline ? rawRecordBaseline : bestStreak, bestStreak)

    return {
      bestStreak,
      currentStreak,
      recordStreakBaseline,
      tasksCompleted,
      timePlayedMs,
    }
  } catch {
    return cloneStats(DEFAULT_STATS)
  }
}
