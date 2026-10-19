'use client'

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createStore } from '../store'
import { AuthBootstrap } from '../components/AuthBootstrap'

type ProvidersProps = { children: ReactNode }

export default function Providers({ children }: ProvidersProps) {
  const [store] = useState(createStore)

  return (
    <Provider store={store}>
      <AuthBootstrap>{children}</AuthBootstrap>
    </Provider>
  )
}
