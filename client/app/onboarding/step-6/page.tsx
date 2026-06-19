'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Step6Page() {
  const router = useRouter()
  useEffect(() => { router.replace('/execution-center') }, [router])
  return null
}
