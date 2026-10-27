export const fixedStepParityCases = [
  { delta: 0.05, ticks: 1, tick: 1, remainder: 0, fraction: 0, overloaded: false },
  { delta: 0.1, ticks: 2, tick: 2, remainder: 0, fraction: 0, overloaded: false },
  { delta: 0.12, ticks: 2, tick: 2, remainder: 0.02, fraction: 0.4, overloaded: false },
  { delta: 0.01, ticks: 0, tick: 0, remainder: 0.01, fraction: 0.2, overloaded: false },
  { delta: 0.3, ticks: 5, tick: 5, remainder: 0, fraction: 0, overloaded: true },
] as const
