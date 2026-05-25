declare module 'ebisu-js/dist/ebisu.min.mjs' {
  export type Model = [number, number, number]

  export function defaultModel(t: number, a?: number, b?: number): Model
  export function predictRecall(prior: Model, tnow: number, exact?: boolean): number
  export function updateRecall(
    prior: Model,
    successes: number,
    total: number,
    tnow: number,
    q0?: number,
  ): Model
}
