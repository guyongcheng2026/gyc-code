import { Audio, type AudioErrorContext, type AudioPlayOptions, type AudioSound, type AudioVoice } from "@opentui/core"
import { readFile } from "node:fs/promises"

let audio: Audio | null | undefined
const sounds = new Map<string, Promise<AudioSound | null>>()
const SOUND_CACHE_TTL = 5 * 60 * 1000 // 5分钟
const soundCacheTimestamps = new Map<string, number>()

function getAudio() {
  if (audio !== undefined) return audio
  try {
    const next = Audio.create({ autoStart: false })
    next.on("error", (error: Error, context: AudioErrorContext) => {
      console.debug("tui audio error", { error, context })
    })
    audio = next
    return next
  } catch (error) {
    console.debug("failed to create tui audio", { error })
    audio = null
    return null
  }
}

export function loadSoundFile(file: string) {
  const current = getAudio()
  if (!current) return Promise.resolve(null)
  
  // 清理过期缓存
  const now = Date.now()
  for (const [key, timestamp] of soundCacheTimestamps.entries()) {
    if (now - timestamp > SOUND_CACHE_TTL) {
      sounds.delete(key)
      soundCacheTimestamps.delete(key)
    }
  }
  
  const cached = sounds.get(file)
  if (cached) {
    soundCacheTimestamps.set(file, Date.now())
    return cached
  }
  const task = readFile(file)
    .then((bytes) => current.loadSound(bytes))
    .catch((error) => {
      console.debug("failed to load tui sound", { file, error })
      return null
    })
  sounds.set(file, task)
  soundCacheTimestamps.set(file, Date.now())
  return task
}

export function play(sound: AudioSound, options?: AudioPlayOptions) {
  const current = getAudio()
  if (!current) return null
  if (!current.isStarted() && !current.start()) return null
  return current.play(sound, options)
}

export function stopVoice(voice: AudioVoice) {
  return audio?.stopVoice(voice) ?? false
}

export function dispose() {
  audio?.dispose()
  audio = undefined
  sounds.clear()
}
