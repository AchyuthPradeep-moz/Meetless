import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'Meetless',
  description: 'Spend less time in meetings, more time doing.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `(function(){var t=localStorage.getItem('meetless_theme');if(t==='dark')document.documentElement.classList.add('dark');}())` }} />
      </head>
      <body className="h-full antialiased">{children}</body>
    </html>
  )
}
