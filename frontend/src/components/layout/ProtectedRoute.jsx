import { Navigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';

export function ProtectedRoute({ children }) {
  const { userData, loading, isSupabaseConfigured } = useAuth();

  if (loading) {
    return <div className="loading-screen">Carregando...</div>;
  }

  if (!isSupabaseConfigured) {
    return (
      <div className="loading-screen">
        <div className="alert alert-error" style={{ maxWidth: 480 }}>
          Configure o Supabase no arquivo .env (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).
        </div>
      </div>
    );
  }

  if (!userData) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
