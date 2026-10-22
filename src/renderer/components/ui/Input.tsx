import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-md border border-border bg-surface-2 px-2.5 text-[13px] text-ink',
        'placeholder:text-ink-faint focus:border-accent focus:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'w-full resize-none rounded-md border border-border bg-surface-2 p-2.5 text-[13px] text-ink',
        'placeholder:text-ink-faint focus:border-accent focus:outline-none',
        className
      )}
      {...props}
    />
  )
}

export function Select({ className, ...props }: InputHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-8 w-full rounded-md border border-border bg-surface-2 px-2 text-[13px] text-ink',
        'focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
      {...props}
    />
  )
}
