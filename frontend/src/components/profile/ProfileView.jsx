import { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { FormInput, FormPasswordInput } from '../ui/FormComponents';
import { AzoupLogo, IconMoon, IconSun } from '../ui/Icons';
import {
  updatePassword,
  updateProfileName,
  updateProfilePhotoUrl,
  uploadProfilePhoto,
} from '../../services/profileService';
import { toFriendlyErrorMessage } from '../../utils/helpers';

export function ProfileView() {
  const { userData, refreshProfile } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const [nome, setNome] = useState('');
  const [fotoUrl, setFotoUrl] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setNome(userData?.nome || '');
    setFotoUrl(userData?.foto_perfil_url || '');
  }, [userData?.nome, userData?.foto_perfil_url]);

  const clearFeedback = () => {
    setError('');
    setSuccess('');
  };

  const handleSaveName = async (e) => {
    e.preventDefault();
    clearFeedback();

    const trimmed = nome.trim();
    if (!trimmed) {
      setError('Informe o nome.');
      return;
    }

    setSavingName(true);
    try {
      await updateProfileName(userData.id, trimmed);
      await refreshProfile();
      setSuccess('Nome atualizado com sucesso.');
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setSavingName(false);
    }
  };

  const handlePhotoChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    clearFeedback();
    setUploadingPhoto(true);
    try {
      const result = await uploadProfilePhoto(file);
      await updateProfilePhotoUrl(userData.id, result.url);
      setFotoUrl(result.url);
      await refreshProfile();
      setSuccess('Foto de perfil atualizada.');
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setUploadingPhoto(false);
      e.target.value = '';
    }
  };

  const handleSavePassword = async (e) => {
    e.preventDefault();
    clearFeedback();

    if (!newPassword || newPassword.length < 6) {
      setError('A nova senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('As senhas não coincidem.');
      return;
    }

    setSavingPassword(true);
    try {
      await updatePassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setSuccess('Senha alterada com sucesso.');
    } catch (err) {
      setError(toFriendlyErrorMessage(err));
    } finally {
      setSavingPassword(false);
    }
  };

  const userEmail = userData?.usuario || userData?.email || '';

  return (
    <div className="profile-edit-page">
      <div className="profile-edit-inner">
        <div className="profile-edit-header">
          <h1>Meu perfil</h1>
        </div>

        {error && <div className="alert alert-error">{error}</div>}
        {success && <div className="alert alert-success">{success}</div>}

        <div className="product-form-card profile-edit-card">
          <section className="profile-edit-section">
            <h3>Foto de perfil</h3>
            <div className="profile-avatar-row">
              <div className="profile-avatar-preview">
                {fotoUrl ? (
                  <img src={fotoUrl} alt="" />
                ) : (
                  <AzoupLogo size={48} />
                )}
              </div>
              <div className="profile-avatar-actions">
                <p className="profile-edit-hint">{userEmail}</p>
                <label className="profile-photo-upload">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handlePhotoChange}
                    disabled={uploadingPhoto}
                    hidden
                  />
                  {uploadingPhoto ? 'Enviando...' : 'Alterar foto'}
                </label>
              </div>
            </div>
          </section>

          <section className="profile-edit-section">
            <h3>Nome</h3>
            <form onSubmit={handleSaveName} className="profile-inline-form">
              <FormInput
                label="Nome completo"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                placeholder="Seu nome"
              />
              <button type="submit" className="btn btn-primary btn-sm profile-inline-btn" disabled={savingName}>
                {savingName ? 'Salvando...' : 'Salvar'}
              </button>
            </form>
          </section>

          <section className="profile-edit-section">
            <h3>Alterar senha</h3>
            <form onSubmit={handleSavePassword}>
              <div className="form-grid profile-edit-form-grid">
                <FormPasswordInput
                  label="Nova senha"
                  required
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  autoComplete="new-password"
                />
                <FormPasswordInput
                  label="Confirmar nova senha"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  minLength={6}
                  autoComplete="new-password"
                />
              </div>
              <div className="settings-form-actions">
                <button type="submit" className="btn btn-primary btn-sm" disabled={savingPassword}>
                  {savingPassword ? 'Salvando...' : 'Alterar senha'}
                </button>
              </div>
            </form>
          </section>

          <section className="profile-edit-section profile-edit-section--last">
            <h3>Aparência</h3>
            <div className="profile-theme-row">
              <p className="profile-edit-hint profile-theme-desc">Tema da interface</p>
              <div className="profile-theme-options">
                <button
                  type="button"
                  className={`profile-theme-option ${!isDark ? 'profile-theme-option--active' : ''}`}
                  onClick={() => { if (isDark) toggleTheme(); }}
                >
                  <IconSun size={16} />
                  <span>Claro</span>
                </button>
                <button
                  type="button"
                  className={`profile-theme-option ${isDark ? 'profile-theme-option--active' : ''}`}
                  onClick={() => { if (!isDark) toggleTheme(); }}
                >
                  <IconMoon size={16} />
                  <span>Escuro</span>
                </button>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
