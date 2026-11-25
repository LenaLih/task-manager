export type AdminOverview = {
  users: number
  registeredToday: number
  registered7: number
  registered30: number
  active7: number
  active30: number
  tasks: number
  completed: number
  projects: number
  trackingSince: string
  registrations: { day: string; count: number | null }[]
}

export type AdminUser = {
  name: string
  email: string
  registeredAt: string | null
  registrationKnownBy: string | null
  lastActiveAt: string | null
  tasks: number
  completed: number
  projects: number
  role: 'user' | 'admin'
}

export type AdminUsers = { total: number; users: AdminUser[] }
export type AdminSort = Exclude<keyof AdminUser, 'registrationKnownBy'>
export type AdminUsersQuery = {
  search: string
  page: number
  sort: AdminSort
  direction: 'asc' | 'desc'
}
