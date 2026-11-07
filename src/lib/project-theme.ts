const SLOT_COLORS = 4

export function projectVar(index: number): string {
  return `--project-${(index % SLOT_COLORS) + 1}`
}

export function projectColor(index: number): string {
  return `var(${projectVar(index)})`
}

export function projectTint(index: number, percent = 10): string {
  return `color-mix(in srgb, var(${projectVar(index)}) ${percent}%, transparent)`
}

export function projectBorder(index: number, percent = 28): string {
  return `color-mix(in srgb, var(${projectVar(index)}) ${percent}%, var(--border))`
}

export const PROJECT_NUMBERS = ['01', '02', '03', '04']
