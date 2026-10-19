import { Mutex } from 'async-mutex'
import type { FetchBaseQueryError, FetchBaseQueryMeta, QueryReturnValue } from '@reduxjs/toolkit/query'

export type RefreshResult = QueryReturnValue<unknown, FetchBaseQueryError, FetchBaseQueryMeta>

export function createAuthCoordinator() {
  return {
    mutex: new Mutex(),
    signingOut: false,
    refresh: undefined as Promise<RefreshResult> | undefined,
  }
}

export type StoreExtra = {
  authCoordinator: ReturnType<typeof createAuthCoordinator>
}
