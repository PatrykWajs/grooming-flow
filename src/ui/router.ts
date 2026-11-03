import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'today' }
  | { name: 'wardrobe' }
  | { name: 'add' }
  | { name: 'item'; id: string }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'onboarding' }

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, '').split('?')[0]
  const [head, id] = path.split('/')
  switch (head) {
    case 'wardrobe':
      return { name: 'wardrobe' }
    case 'add':
      return { name: 'add' }
    case 'item':
      return id ? { name: 'item', id: decodeURIComponent(id) } : { name: 'wardrobe' }
    case 'history':
      return { name: 'history' }
    case 'settings':
      return { name: 'settings' }
    case 'onboarding':
      return { name: 'onboarding' }
    default:
      return { name: 'today' }
  }
}

export function toHash(route: Route): string {
  switch (route.name) {
    case 'item':
      return `#/item/${encodeURIComponent(route.id)}`
    default:
      return `#/${route.name}`
  }
}

export function navigate(route: Route): void {
  location.hash = toHash(route)
}

const subscribe = (callback: () => void) => {
  window.addEventListener('hashchange', callback)
  return () => window.removeEventListener('hashchange', callback)
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, () => location.hash, () => '')
  return parseHash(hash)
}
