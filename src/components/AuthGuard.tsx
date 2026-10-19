'use client'

import { Fragment, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useAppSelector } from '../store'

type AuthGuardProps = { children: ReactNode }

export function AuthGuard({ children }: AuthGuardProps) {
  const router = useRouter()
  const { initialized, session } = useAppSelector((state) => state.auth)

  useEffect(() => {
    if (initialized && !session) router.replace('/login')
  }, [initialized, router, session])

  if (!initialized || !session) return null
  return <Fragment key={session.user.id}>{children}</Fragment>
}
