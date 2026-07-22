/// <reference types="vite/client" />

declare module '*.png?inline' {
  const src: string
  export default src
}

declare module 'mailrovers:startup-splash-shared-css' {
  const css: string
  export default css
}
