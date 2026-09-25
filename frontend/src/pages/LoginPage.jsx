import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { FormInput, FormPasswordInput } from '../components/ui/FormComponents';
import { AzoupLogo, IconCart, IconChevronRight, IconMoon, IconSun } from '../components/ui/Icons';
import { requestPasswordReset, completePasswordReset } from '../services/storageService';
import { toFriendlyErrorMessage } from '../utils/helpers';

function PasswordResetModal({ onClose }) {
  const [step, setStep] = useState(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleRequest = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setSuccess('Código enviado para o e-mail informado.');
      setStep(2);
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleComplete = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await completePasswordReset(email.trim().toLowerCase(), code, newPassword);
      setSuccess('Senha redefinida com sucesso!');
      setTimeout(onClose, 1500);
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content login-reset-modal" onClick={(e) => e.stopPropagation()}>
        <h2>Esqueceu a senha?</h2>
        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        {step === 1 ? (
          <form onSubmit={handleRequest}>
            <FormInput
              label="E-mail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose}>Cancelar</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Enviando...' : 'Enviar código'}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleComplete}>
            <FormInput
              label="Código (6 dígitos)"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
            />
            <FormPasswordInput
              label="Nova senha"
              required
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={6}
            />
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setStep(1)}>Voltar</button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? 'Salvando...' : 'Redefinir senha'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function LoginPage() {
  const { signIn, userData, isSupabaseConfigured } = useAuth();
  const { toggleTheme, isDark } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    if (userData) navigate('/app', { replace: true });
  }, [userData, navigate]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim() || !password) {
      setError('Preencha e-mail e senha.');
      return;
    }

    setLoading(true);
    try {
      await signIn(email, password);
      navigate('/app', { replace: true });
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-page-decor" aria-hidden="true">
        <span className="login-blob login-blob--1" />
        <span className="login-blob login-blob--2" />
        <span className="login-blob login-blob--3" />
      </div>

      <header className="login-topbar">
        <div className="login-topbar-brand">
          <AzoupLogo size={32} />
          <span>Azoup</span>
        </div>
        <button
          type="button"
          className="login-theme-toggle"
          onClick={toggleTheme}
          aria-label="Alternar tema"
        >
          {isDark ? <IconSun size={18} /> : <IconMoon size={18} />}
        </button>
      </header>

      <main className="login-main">
        <div className="login-card">
          <div className="login-card-header">
            <span className="login-badge">
              <IconCart size={14} />
              Integração com e-commerce
            </span>
            <div className="login-logo-mark">
              <AzoupLogo size={56} />
            </div>
            <h1>Entrar na plataforma</h1>
            <p className="login-card-desc">
              Sistema de integração com e-commerce para sua confecção.
              Sincronize produtos, estoque e pedidos com suas lojas online.
            </p>
          </div>

          {!isSupabaseConfigured && (
            <div className="alert alert-info login-alert">
              Configure o Supabase no arquivo .env para conectar ao sistema.
            </div>
          )}

          {error && <div className="login-error">{error}</div>}

          <form className="login-form" onSubmit={handleSubmit}>
            <FormInput
              label="E-mail"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="seu@email.com"
              autoComplete="email"
            />
            <FormPasswordInput
              label="Senha"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />

            <div className="login-actions">
              <button type="button" className="login-forgot-link" onClick={() => setShowReset(true)}>
                Esqueceu a senha?
              </button>
            </div>

            <button
              type="submit"
              className="btn btn-primary login-submit"
              disabled={loading || !isSupabaseConfigured}
            >
              {loading ? 'Entrando...' : (
                <>
                  Entrar
                  <IconChevronRight size={18} />
                </>
              )}
            </button>
          </form>
        </div>
      </main>

      {showReset && <PasswordResetModal onClose={() => setShowReset(false)} />}
    </div>
  );
}
