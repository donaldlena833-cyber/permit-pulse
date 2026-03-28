import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[16px] border border-transparent text-sm font-medium tracking-[-0.01em] transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D4691A]/35 focus-visible:ring-offset-2 focus-visible:ring-offset-[#FFF8F1] active:translate-y-[1px] disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[#1A1A1A] text-white shadow-[0_12px_28px_rgba(26,26,26,0.18)] hover:bg-[#111111] hover:shadow-[0_16px_32px_rgba(26,26,26,0.22)]",
        destructive:
          "bg-[#A94228] text-white shadow-[0_12px_28px_rgba(169,66,40,0.22)] hover:bg-[#913822]",
        outline:
          "border-[#D6C6B6] bg-[rgba(255,255,255,0.92)] text-[#5F564C] shadow-[0_8px_20px_rgba(26,26,26,0.04)] hover:border-[#CDBCA9] hover:bg-white hover:text-[#1A1A1A]",
        secondary:
          "bg-[#F6EEE4] text-[#6B5A48] shadow-[0_8px_18px_rgba(26,26,26,0.04)] hover:bg-[#F1E5D8] hover:text-[#1A1A1A]",
        ghost: "text-[#5F564C] hover:bg-[rgba(255,255,255,0.78)] hover:text-[#1A1A1A]",
        link: "rounded-none border-none px-0 text-[#1A1A1A] shadow-none underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-[14px] px-3 text-xs",
        lg: "h-11 rounded-[18px] px-6",
        icon: "h-10 w-10 rounded-[16px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
