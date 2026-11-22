// 조작 확인·입력 대화상자 (OpDialog.svelte)의 모양

import type { IconName } from './components/Icon.svelte'

export type DialogField =
  | { kind: 'text'; key: string; label: string; value?: string; placeholder?: string; required?: boolean; multiline?: boolean; mono?: boolean }
  | { kind: 'select'; key: string; label: string; value: string; options: { value: string; label: string }[]; hint?: string }
  | { kind: 'check'; key: string; label: string; value?: boolean; hint?: string; danger?: boolean }
  | { kind: 'info'; text: string; tone?: 'warn' | 'danger' | 'muted' | 'ok' }
  | { kind: 'list'; label?: string; items: string[]; max?: number }
  | { kind: 'output'; text: string }

export type DialogValues = Record<string, string | boolean>

export interface DialogSpec {
  title: string
  icon?: IconName
  fields: DialogField[]
  /** 확인 버튼 글 (기본 "확인") */
  ok?: string
  /** 취소 버튼 글. null이면 확인 버튼만 (출력 보기) */
  cancel?: string | null
  /** 되돌리기 어려운 조작: 확인 버튼을 빨갛게 */
  danger?: boolean
  /** 확인 전에 검사. 문제가 있으면 그 글 */
  validate?: (v: DialogValues) => string | null
}

/** 처음 값 (입력 칸·고르기·체크) */
export function initialValues(fields: DialogField[]): DialogValues {
  const v: DialogValues = {}
  for (const f of fields) {
    if (f.kind === 'text') v[f.key] = f.value ?? ''
    else if (f.kind === 'select') v[f.key] = f.value
    else if (f.kind === 'check') v[f.key] = f.value ?? false
  }
  return v
}

/** 빈 필수 칸이 있으면 그 이름 */
export function missingField(fields: DialogField[], v: DialogValues): string | null {
  for (const f of fields) if (f.kind === 'text' && f.required && !String(v[f.key] ?? '').trim()) return f.label
  return null
}
