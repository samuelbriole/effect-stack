/** Private detached-command capabilities of exact assembled router values. @since 0.4.0 */
import type { resolveNavigationTarget } from "./destinations.ts"
import type { NavigateOptions } from "./coordinator.ts"

export interface DetachedCommands {
  readonly navigate: (target: Parameters<typeof resolveNavigationTarget>[1], options?: NavigateOptions) => void
  readonly retry: () => void
}

const commands = new WeakMap<object, DetachedCommands>()

export const registerDetachedCommands = (router: object, executor: DetachedCommands): void => {
  commands.set(router, executor)
}

export const detachedCommands = (router: object): DetachedCommands | undefined => commands.get(router)
