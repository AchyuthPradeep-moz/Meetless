'use client'
import { useEffect, useState } from 'react'

export function useTheme() {
  const [dark, setDark] = useState(false)

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggle = () => {
    const isDark = document.documentElement.classList.toggle('dark')
    setDark(isDark)
    localStorage.setItem('meetless_theme', isDark ? 'dark' : 'light')
  }

  return { dark, toggle }
}
