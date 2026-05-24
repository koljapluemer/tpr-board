import type { IconNode } from 'lucide'

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'

export function createLucideIcon(icon: IconNode, attributes: Record<string, string> = {}) {
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg')

  const baseAttributes = {
    xmlns: SVG_NAMESPACE,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
    ...attributes,
  }

  Object.entries(baseAttributes).forEach(([name, value]) => {
    svg.setAttribute(name, value)
  })

  icon.forEach(([tagName, childAttributes]) => {
    const child = document.createElementNS(SVG_NAMESPACE, tagName)

    Object.entries(childAttributes).forEach(([name, value]) => {
      if (value !== undefined) {
        child.setAttribute(name, String(value))
      }
    })

    svg.appendChild(child)
  })

  return svg
}
