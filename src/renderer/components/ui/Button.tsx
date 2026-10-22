import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors ' +
    'disabled:cursor-not-allowed disabled:opacity-45 select-none whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-accent text-canvas hover:opacity-90',
        secondary: 'bg-surface-2 text-ink border border-border hover:bg-elevated',
        ghost: 'text-ink-muted hover:bg-surface-2 hover:text-ink',
        danger: 'bg-danger text-canvas hover:opacity-90',
        outline: 'border border-border-strong text-ink hover:bg-surface-2'
      },
      size: {
        sm: 'h-7 px-2 text-xs',
        md: 'h-8 px-3 text-[13px]',
        lg: 'h-9 px-4 text-sm'
      }
    },
    defaultVariants: { variant: 'secondary', size: 'md' }
  }
)

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  children?: ReactNode
}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}
