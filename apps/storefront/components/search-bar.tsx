"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import { Search } from "lucide-react"
import { t, type Locale } from "@/lib/i18n"

export function SearchBar({ locale }: { locale: Locale }) {
  const router = useRouter()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get("q") ?? "")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const q = value.trim()
    if (!q) return
    router.push(`/${locale}/search?q=${encodeURIComponent(q)}`)
  }

  return (
    <form onSubmit={submit} role="search" className="relative w-full">
      <Search
        className="pointer-events-none absolute start-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <input
        type="search"
        name="q"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        enterKeyHint="search"
        placeholder={t(locale, "search.placeholder")}
        aria-label={t(locale, "search.placeholder")}
        className="h-11 w-full rounded-xl border border-border bg-card ps-11 pe-4 text-sm text-foreground shadow-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/40"
      />
    </form>
  )
}
