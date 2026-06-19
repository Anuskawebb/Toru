'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function Step5Page() {
  const router = useRouter()
  useEffect(() => { router.replace('/execution-center') }, [router])
  return null
}
