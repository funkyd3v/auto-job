import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth-store'
import Login from '@/pages/Login'
import AppShell from '@/components/layout/AppShell'
import Overview from '@/pages/Overview'
import Jobs from '@/pages/Jobs'
import Sources from '@/pages/Sources'
import Skills from '@/pages/Skills'
import Settings from '@/pages/Settings'
import Logs from '@/pages/Logs'

function Protected({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Protected><AppShell /></Protected>}>
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="overview" element={<Overview />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="sources" element={<Sources />} />
          <Route path="skills" element={<Skills />} />
          <Route path="settings" element={<Settings />} />
          <Route path="logs" element={<Logs />} />
        </Route>
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
