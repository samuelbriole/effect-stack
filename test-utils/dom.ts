export const requireElement = <T extends Element = HTMLElement>(container: ParentNode, selector: string): T => {
  const element = container.querySelector<T>(selector)
  if (element === null) throw new Error(`Missing element: ${selector}`)
  return element
}
