"use client"

import Image from "next/image"
import { useState } from "react"
import { cn } from "@/lib/utils"
import type { ProductImage } from "@/lib/medusa"

export function Gallery({ images, title }: { images: ProductImage[]; title: string }) {
  const [active, setActive] = useState(0)
  const list = images.length ? images : []

  if (!list.length) {
    return (
      <div className="flex aspect-square items-center justify-center rounded-2xl bg-muted text-sm text-muted-foreground">
        لا توجد صورة
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-2xl border border-border bg-muted">
        <Image
          src={list[active]?.url || "/placeholder.svg"}
          alt={title}
          fill
          priority
          sizes="(max-width: 1024px) 100vw, 50vw"
          className="object-cover"
        />
      </div>

      {list.length > 1 ? (
        <div className="grid grid-cols-5 gap-2 sm:gap-3">
          {list.map((img, i) => (
            <button
              key={img.id ?? i}
              type="button"
              onClick={() => setActive(i)}
              aria-label={`عرض الصورة ${i + 1}`}
              aria-current={i === active}
              className={cn(
                "relative aspect-square overflow-hidden rounded-lg border bg-muted transition-colors",
                i === active ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/30",
              )}
            >
              <Image src={img.url || "/placeholder.svg"} alt="" fill sizes="20vw" className="object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
