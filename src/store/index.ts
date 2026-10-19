import { configureStore } from '@reduxjs/toolkit'
import { useDispatch, useSelector } from 'react-redux'
import { authReducer } from './auth'
import { taskApi } from './api'
export const createStore = () => configureStore({ reducer: { auth: authReducer, [taskApi.reducerPath]: taskApi.reducer }, middleware: getDefault => getDefault().concat(taskApi.middleware) })
export const store = createStore()
export type RootState = ReturnType<typeof store.getState>
export const useAppDispatch = useDispatch.withTypes<typeof store.dispatch>()
export const useAppSelector = useSelector.withTypes<RootState>()
