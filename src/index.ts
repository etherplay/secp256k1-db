import { handleRPC } from './handler'

addEventListener('fetch', (event) => {
  event.respondWith(handleRPC(event.request))
})
