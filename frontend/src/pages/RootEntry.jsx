import { Navigate } from 'react-router-dom';
import { hasOAuthCallbackParams, NuvemshopOAuthRelay } from './NuvemshopOAuthRelay';

export function RootEntry() {
  if (hasOAuthCallbackParams()) {
    return <NuvemshopOAuthRelay />;
  }
  return <Navigate to="/login" replace />;
}
